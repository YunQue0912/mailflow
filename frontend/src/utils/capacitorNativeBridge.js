let installed = false;
let plugin = null;
let registerNativePlugin = null;
let installPromise = null;
let pluginUnavailable = false;

function normalizeUpdateStatus(status) {
  if (!status?.data || typeof status.data !== 'object') return status;
  return { ...status, ...status.data };
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

export async function installCapacitorNativeBridge() {
  if (installed) return true;
  if (installPromise) return installPromise;

  installPromise = (async () => {
    if (!window.Capacitor?.isNativePlatform?.()) return false;

    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return false;
    registerNativePlugin = registerPlugin;

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
        getState: async () => normalizeUpdateStatus(await callNative('getUpdateState', undefined, { type: 'idle' })),
        check: async (verbose) => callNative('checkForUpdates', { verbose }),
        download: async () => callNative('downloadUpdate', undefined, { started: false, reason: 'unavailable' }),
        cancel: async () => callNative('cancelUpdateDownload', undefined, { cancelled: false }),
        installDownloaded: async () => callNative('installDownloadedUpdate', undefined, { installed: false, reason: 'unavailable' }),
        installAuto: async () => callNative('installDownloadedUpdate', undefined, { installed: false, reason: 'unavailable' }),
        openDownload: async () => callNative('openUpdateInBrowser'),
        onStatus: (callback) => {
          if (pluginUnavailable) return () => {};
          const MailFlowNative = getPlugin();
          const handlePromise = MailFlowNative.addListener('updateStatus', (status) => callback(normalizeUpdateStatus(status))).catch(() => null);
          return () => {
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
