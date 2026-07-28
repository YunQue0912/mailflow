'use strict';

const { parseCustomVersion } = require('../shared/custom-release.cjs');

const RELEASE_BASE_URL = 'https://github.com/YunQue0912/mailflow/releases';

function createNativeUpdater({
  app,
  shell,
  getWindow,
  updater: providedUpdater,
  createCancellationToken: providedCancellationTokenFactory,
  prepareToInstall = () => {},
  forceExit = () => {},
  scheduleForceExit = (callback) => setTimeout(callback, 500),
}) {
  const updaterModule = providedUpdater && providedCancellationTokenFactory
    ? null
    : require('electron-updater');
  const updater = providedUpdater || updaterModule.autoUpdater;
  const createCancellationToken = providedCancellationTokenFactory
    || (() => new updaterModule.CancellationToken());
  let initialized = false;
  let verboseCheck = false;
  let cancellationToken = null;
  let updateDownloaded = false;
  let installStarted = false;
  let state = {
    type: 'idle',
    currentVersion: app.getVersion(),
  };

  function send(type, data = {}) {
    state = {
      ...state,
      ...data,
      type,
      currentVersion: app.getVersion(),
    };
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('mailflow:updates:status', state);
    }
    return state;
  }

  function releaseData(info = {}) {
    const version = String(info.version || '').replace(/^v/, '');
    const parsed = parseCustomVersion(version);
    const file = Array.isArray(info.files)
      ? info.files.find((entry) => /-Setup\.exe$/i.test(entry.url || entry.path || '')) || info.files[0]
      : null;
    return {
      version: parsed?.versionName || version,
      tag: parsed?.tag || null,
      releaseName: info.releaseName || parsed?.tag || version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      releaseDate: info.releaseDate || null,
      size: Number(file?.info?.size || file?.size || 0),
      releaseUrl: parsed ? `${RELEASE_BASE_URL}/tag/${parsed.tag}` : RELEASE_BASE_URL,
    };
  }

  function initialize() {
    if (initialized) return;
    initialized = true;

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = true;
    updater.logger = console;

    updater.on('checking-for-update', () => send('checking', { verbose: verboseCheck }));
    updater.on('update-not-available', () => {
      updateDownloaded = false;
      installStarted = false;
      send('up-to-date', { verbose: verboseCheck, latestVersion: app.getVersion(), progress: null });
    });
    updater.on('update-available', (info) => {
      const data = releaseData(info);
      if (!parseCustomVersion(data.version)) {
        send('error', { messageKey: 'invalidRelease', retryable: false });
        return;
      }
      updateDownloaded = false;
      installStarted = false;
      send('available', { ...data, progress: null, retryable: true });
    });
    updater.on('download-progress', (progress) => {
      send('downloading', {
        progress: {
          percent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
          transferred: Number(progress.transferred || 0),
          total: Number(progress.total || 0),
          bytesPerSecond: Number(progress.bytesPerSecond || 0),
        },
      });
    });
    updater.on('update-downloaded', (info) => {
      cancellationToken = null;
      updateDownloaded = true;
      installStarted = false;
      send('downloaded', { ...releaseData(info), progress: null, retryable: true });
    });
    updater.on('error', (error) => {
      cancellationToken = null;
      installStarted = false;
      console.error('Native update error:', error);
      send('error', {
        messageKey: error?.code === 'ERR_UPDATER_INVALID_RELEASE_FEED' ? 'invalidRelease' : 'genericError',
        retryable: true,
      });
    });
  }

  async function check(verbose = false) {
    initialize();
    verboseCheck = Boolean(verbose);
    if (!app.isPackaged) {
      return send('error', { messageKey: 'packagedOnly', retryable: false, verbose: verboseCheck });
    }
    try {
      const result = await updater.checkForUpdates();
      return {
        updateAvailable: ['available', 'downloaded'].includes(state.type)
          && Boolean(result?.updateInfo && parseCustomVersion(result.updateInfo.version)),
        state,
      };
    } catch (error) {
      console.error('Could not check for native updates:', error);
      return { updateAvailable: false, state };
    }
  }

  async function download() {
    initialize();
    if (state.type !== 'available' && state.type !== 'error') {
      return { started: false, reason: 'not-available', state };
    }
    cancellationToken = createCancellationToken();
    send('downloading', { progress: { percent: 0, transferred: 0, total: state.size || 0, bytesPerSecond: 0 } });
    try {
      await updater.downloadUpdate(cancellationToken);
      return { started: true, state };
    } catch (error) {
      if (cancellationToken?.cancelled) {
        cancellationToken = null;
        send('available', { progress: null });
        return { started: false, cancelled: true, state };
      }
      throw error;
    }
  }

  function cancel() {
    if (!cancellationToken) return { cancelled: false, state };
    cancellationToken.cancel();
    return { cancelled: true, state };
  }

  function install() {
    if (!updateDownloaded) return { installed: false, reason: 'missing-download' };
    if (installStarted) return { installed: false, reason: 'already-installing' };
    installStarted = true;
    send('installing');
    setImmediate(() => {
      try {
        prepareToInstall();
        updater.quitAndInstall(false, true);
        scheduleForceExit(() => {
          console.warn('Forcing MailFlow to exit after handing control to the update installer.');
          forceExit();
        });
      } catch (error) {
        installStarted = false;
        console.error('Could not start native update installer:', error);
        send('error', { messageKey: 'genericError', retryable: true });
      }
    });
    return { installed: true };
  }

  async function openDownload() {
    const url = state.releaseUrl || RELEASE_BASE_URL;
    await shell.openExternal(url);
    return { opened: true };
  }

  return {
    cancel,
    check,
    download,
    getState: () => state,
    initialize,
    install,
    openDownload,
  };
}

module.exports = { createNativeUpdater };
