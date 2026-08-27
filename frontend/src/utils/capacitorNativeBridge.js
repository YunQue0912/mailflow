let installed = false;
let plugin = null;
let registerNativePlugin = null;
let installPromise = null;
let pluginUnavailable = false;
let directUpdatePollGeneration = 0;
let androidMessageRequestSequence = 0;
const DIRECT_UPDATE_TERMINAL_STATES = new Set(['available', 'up-to-date', 'downloaded', 'error']);
const ANDROID_MESSAGE_TIMEOUT_MS = 5000;

function normalizeUpdateStatus(status) {
  if (!status?.data || typeof status.data !== 'object') return status;
  return { ...status, ...status.data };
}

export function callAndroidJavascriptInterface(target, method, args = [], fallback = null) {
  const bridge = target?.MailFlowAndroid;
  if (!bridge || typeof bridge[method] !== 'function') {
    return { available: false, value: fallback };
  }

  try {
    const raw = bridge[method](...args);
    const value = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    return { available: true, value: value ?? fallback };
  } catch {
    return { available: true, value: fallback };
  }
}

export function callAndroidMessageBridge(target, method, args = {}, fallback = null) {
  const bridge = target?.MailFlowAndroid;
  if (!bridge || typeof bridge.postMessage !== 'function') {
    return Promise.resolve({ available: false, value: fallback });
  }

  const requests = target.__mailflowAndroidRequests = target.__mailflowAndroidRequests || {};
  if (!target.__mailflowAndroidMessageHandlerInstalled) {
    const previousHandler = typeof bridge.onmessage === 'function' ? bridge.onmessage : null;
    bridge.onmessage = (event) => {
      try {
        const response = JSON.parse(event?.data || '{}');
        const resolve = requests[response.id];
        if (typeof resolve === 'function') {
          delete requests[response.id];
          resolve(response.error ? undefined : response.result);
          return;
        }
      } catch {
        // Preserve any bridge handler installed by the native compatibility layer.
      }
      previousHandler?.call(bridge, event);
    };
    target.__mailflowAndroidMessageHandlerInstalled = true;
  }

  return new Promise((resolve) => {
    const id = `mailflow-${Date.now()}-${androidMessageRequestSequence += 1}`;
    const timer = setTimeout(() => {
      delete requests[id];
      resolve({ available: true, value: fallback });
    }, ANDROID_MESSAGE_TIMEOUT_MS);

    requests[id] = (value) => {
      clearTimeout(timer);
      resolve({ available: true, value: value ?? fallback });
    };

    try {
      bridge.postMessage(JSON.stringify({ id, method, args: args || {} }));
    } catch {
      clearTimeout(timer);
      delete requests[id];
      resolve({ available: true, value: fallback });
    }
  });
}

export async function pollAndroidUpdateState(target, {
  onStatus = () => {},
  readState = null,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  intervalMs = 250,
  maxAttempts = 120,
} = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const direct = callAndroidJavascriptInterface(target, 'getUpdateState', [], null);
    const rawStatus = direct.available
      ? direct.value
      : (typeof readState === 'function' ? await readState() : null);
    if (!direct.available && typeof readState !== 'function') return null;

    const status = normalizeUpdateStatus(rawStatus);
    if (status?.type) {
      onStatus(status);
      if (DIRECT_UPDATE_TERMINAL_STATES.has(status.type)) return status;
    }

    await wait(intervalMs);
  }

  return null;
}

function dispatchAndroidUpdateStatus(target, status) {
  if (!status || typeof target?.dispatchEvent !== 'function') return;
  target.dispatchEvent(new CustomEvent('mailflow:update-status', { detail: status }));
}

function getPlugin() {
  if (plugin) return plugin;
  if (typeof registerNativePlugin !== 'function') {
    pluginUnavailable = true;
    return null;
  }
  plugin = registerNativePlugin('MailFlowNative');
  return plugin;
}

async function callNative(method, args, fallback = null) {
  if (pluginUnavailable) return fallback;

  try {
    const MailFlowNative = getPlugin();
    if (!MailFlowNative || typeof MailFlowNative[method] !== 'function') return fallback;
    return await MailFlowNative[method](args);
  } catch (error) {
    if (String(error?.message || error).includes('not implemented')) {
      pluginUnavailable = true;
    }
    return fallback;
  }
}

async function callNativeUpdate(androidMethod, androidArgs, pluginMethod, pluginArgs, fallback = null) {
  const direct = callAndroidJavascriptInterface(window, androidMethod, androidArgs, fallback);
  if (direct.available && direct.value?.reason !== 'unavailable') return direct.value;

  const message = await callAndroidMessageBridge(window, pluginMethod, pluginArgs, fallback);
  if (message.available && message.value?.reason !== 'unavailable') return message.value;
  return callNative(pluginMethod, pluginArgs, fallback);
}

export function subscribeNativePluginEvent(pluginFactory, eventName, callback) {
  let handlePromise = Promise.resolve(null);

  try {
    const nativePlugin = typeof pluginFactory === 'function' ? pluginFactory() : null;
    if (!nativePlugin || typeof nativePlugin.addListener !== 'function') return () => {};
    handlePromise = Promise.resolve(nativePlugin.addListener(eventName, callback)).catch(() => null);
  } catch {
    return () => {};
  }

  return () => {
    handlePromise.then((handle) => handle?.remove?.()).catch(() => {});
  };
}

export async function installCapacitorNativeBridge() {
  if (installed) return true;
  if (installPromise) return installPromise;

  installPromise = (async () => {
    const hasAndroidInterface = Boolean(window.MailFlowAndroid);
    const capacitorNative = Boolean(window.Capacitor?.isNativePlatform?.());
    if (!hasAndroidInterface && !capacitorNative) return false;

    if (capacitorNative) {
      const { Capacitor, registerPlugin } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) registerNativePlugin = registerPlugin;
    }

    const existingBridge = window.mailflowNative || {};

    window.mailflowNative = {
      ...existingBridge,
      platform: 'android',
      getHost: async () => {
        const result = await callNative('getHost', undefined, {});
        return result?.host || null;
      },
      saveHost: async (host) => {
        const result = await callNative('saveHost', { host }, { host });
        return result?.host || host;
      },
      resetHost: async () => callNative('resetHost'),
      badges: {
        ...existingBridge.badges,
        setUnreadCount: async (count) => callNative('setUnreadCount', { count }),
      },
      attachments: {
        ...existingBridge.attachments,
        download: async ({ url, filename, mimeType }) => callNative(
          'downloadAttachment',
          { url, filename, mimeType },
          { started: false, reason: 'unavailable' },
        ),
      },
      updates: {
        ...existingBridge.updates,
        getState: async () => normalizeUpdateStatus(await callNativeUpdate(
          'getUpdateState', [], 'getUpdateState', undefined, { type: 'idle' },
        )),
        check: async (verbose) => {
          const current = normalizeUpdateStatus(callAndroidJavascriptInterface(
            window, 'getUpdateState', [], { type: 'idle' },
          ).value);
          if (hasAndroidInterface) {
            dispatchAndroidUpdateStatus(window, {
              ...current,
              type: 'checking',
              verbose: Boolean(verbose),
            });
          }

          const result = await callNativeUpdate(
            'checkForUpdates', [Boolean(verbose)], 'checkForUpdates', { verbose }, { started: false },
          );

          if (!hasAndroidInterface) {
            const state = normalizeUpdateStatus(await callNativeUpdate(
              'getUpdateState', [], 'getUpdateState', undefined, { type: 'idle' },
            ));
            return { ...result, state };
          }

          const pollGeneration = ++directUpdatePollGeneration;
          if (!result?.started) {
            const state = {
              ...current,
              type: 'error',
              messageKey: 'genericError',
              retryable: true,
              verbose: Boolean(verbose),
            };
            dispatchAndroidUpdateStatus(window, state);
            return { ...result, error: 'update-check-failed', state };
          }

          const state = await pollAndroidUpdateState(window, {
            readState: async () => normalizeUpdateStatus(await callNativeUpdate(
              'getUpdateState', [], 'getUpdateState', undefined, { type: 'idle' },
            )),
            onStatus: (status) => {
              if (pollGeneration === directUpdatePollGeneration) {
                dispatchAndroidUpdateStatus(window, status);
              }
            },
          }).catch(() => null);

          if (state) return { ...result, state };

          const errorState = {
            ...current,
            type: 'error',
            messageKey: 'genericError',
            retryable: true,
            verbose: Boolean(verbose),
          };
          if (pollGeneration === directUpdatePollGeneration) {
            dispatchAndroidUpdateStatus(window, errorState);
          }
          return { ...result, error: 'update-check-failed', state: errorState };
        },
        download: async () => callNativeUpdate(
          'downloadUpdate', [], 'downloadUpdate', undefined, { started: false, reason: 'unavailable' },
        ),
        cancel: async () => callNativeUpdate(
          'cancelUpdateDownload', [], 'cancelUpdateDownload', undefined, { cancelled: false },
        ),
        installDownloaded: async () => callNativeUpdate(
          'installDownloadedUpdate', [], 'installDownloadedUpdate', undefined, { installed: false, reason: 'unavailable' },
        ),
        installAuto: async () => callNativeUpdate(
          'installDownloadedUpdate', [], 'installDownloadedUpdate', undefined, { installed: false, reason: 'unavailable' },
        ),
        openDownload: async () => callNativeUpdate(
          'openUpdateInBrowser', [], 'openUpdateInBrowser', undefined, { opened: false },
        ),
        onStatus: (callback) => {
          const onDomStatus = (event) => callback(normalizeUpdateStatus(event.detail));
          window.addEventListener('mailflow:update-status', onDomStatus);
          const unsubscribePlugin = !hasAndroidInterface && !pluginUnavailable
            ? subscribeNativePluginEvent(
              getPlugin,
              'updateStatus',
              (status) => callback(normalizeUpdateStatus(status)),
            )
            : () => {};
          return () => {
            window.removeEventListener('mailflow:update-status', onDomStatus);
            unsubscribePlugin();
          };
        },
      },
      notifications: {
        ...existingBridge.notifications,
        checkPermission: async () => {
          const result = await callNative('checkNotificationPermission', undefined, {});
          return result?.permission || 'default';
        },
        requestPermission: async () => {
          const result = await callNative('requestNotificationPermission', undefined, {});
          return result?.permission || 'default';
        },
        openSettings: async () => callNative('openNotificationSettings'),
        showNewMail: async (notification) => callNative('showNewMail', notification || {}),
      },
      actions: {
        ...existingBridge.actions,
        getPending: async () => {
          const result = await callNative('getPendingActions', undefined, {});
          return result?.actions || [];
        },
        ack: async (id) => callNative('ackAction', { id }),
        onAction: (callback) => (pluginUnavailable
          ? () => {}
          : subscribeNativePluginEvent(getPlugin, 'nativeAction', callback)),
      },
    };

    installed = true;
    return true;
  })();

  return installPromise;
}
