let installed = false;
let plugin = null;
let registerNativePlugin = null;
let installPromise = null;
let pluginUnavailable = false;

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

function getPlugin() {
  if (plugin) return plugin;
  plugin = registerNativePlugin('MailFlowNative');
  return plugin;
}

async function callNative(method, args, fallback = null) {
  if (pluginUnavailable) return fallback;

  try {
    const MailFlowNative = getPlugin();
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
  if (direct.available) return direct.value;
  return callNative(pluginMethod, pluginArgs, fallback);
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
      updates: {
        ...existingBridge.updates,
        getState: async () => normalizeUpdateStatus(await callNativeUpdate(
          'getUpdateState', [], 'getUpdateState', undefined, { type: 'idle' },
        )),
        check: async (verbose) => callNativeUpdate(
          'checkForUpdates', [Boolean(verbose)], 'checkForUpdates', { verbose }, { started: false },
        ),
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
          const handlePromise = !hasAndroidInterface && registerNativePlugin && !pluginUnavailable
            ? getPlugin().addListener('updateStatus', (status) => callback(normalizeUpdateStatus(status))).catch(() => null)
            : Promise.resolve(null);
          return () => {
            window.removeEventListener('mailflow:update-status', onDomStatus);
            handlePromise.then((handle) => handle?.remove?.()).catch(() => {});
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
        onAction: (callback) => {
          if (pluginUnavailable) return () => {};
          const MailFlowNative = getPlugin();
          const handlePromise = MailFlowNative.addListener('nativeAction', callback).catch(() => null);
          return () => {
            handlePromise.then((handle) => handle?.remove?.()).catch(() => {});
          };
        },
      },
    };

    installed = true;
    return true;
  })();

  return installPromise;
}
