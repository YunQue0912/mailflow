const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, dialog, Notification, session, clipboard } = require('electron');
const { execFileSync, spawn } = require('child_process');

const fs = require('fs');
const path = require('path');
const { createNativeUpdater } = require('./native-updater.cjs');
const { pathToFileURL } = require('url');
const { sendMailFlowApiRequest } = require('./mailApi.cjs');
const {
  createNavigationPolicy,
  isSameOrigin,
  normalizeHost,
} = require('./security.cjs');
const { createNotificationRetainer } = require('./notificationRetainer.cjs');
const { configureWindowOpening } = require('./windowOpening.cjs');

// New-mail notifications stay referenced while they can be clicked (#587).
const newMailNotifications = createNotificationRetainer();


const CONFIG_FILE = 'mailflow-host.json';
const NATIVE_ACTION_CHANNEL = 'mailflow:native-action';
const NATIVE_ACTION_ARG = '--mailflow-action=';
const NEW_MAIL_NOTIFICATION_MAX_LENGTH = 240;
const MAILTO_PROTOCOL = 'mailto';
const EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:', `${MAILTO_PROTOCOL}:`]);
const REWRITE_ERROR_PATTERNS = [
  /Rewrite\s+502\s+Bad\s+Gateway\s+Page/i,
  /Rewrite\s+404\s+Error\s+Page/i,
];
const HOST_UNAVAILABLE_STATUS_CODES = new Set([404, 502, 503, 504]);
const LINUX_BADGE_DESKTOP_IDS = [
  'MailFlow.desktop',
  'mailflow.desktop',
  'sh.mailflow.app.desktop',
  'mailflow-frontend.desktop',
];

let mainWindow;
let tray = null;
let isQuitting = false;
let nextNativeActionId = 1;
const nativeUpdater = createNativeUpdater({
  app,
  shell,
  getWindow: () => mainWindow,
  prepareToInstall: prepareToInstallUpdate,
  forceExit: () => app.exit(0),
});

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function prepareToInstallUpdate() {
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) saveWindowBounds();
  destroyTray();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
}

function isAllowedExternalUrl(url) {
  try {
    return EXTERNAL_LINK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
const pendingNativeActions = new Map();
const pendingProtocolUrls = [];

app.setName('MailFlow');
if (process.platform === 'win32') {
  app.setAppUserModelId('sh.mailflow.app');
}
if (process.platform === 'linux' && typeof app.setDesktopName === 'function') {
  app.setDesktopName('MailFlow.desktop');
}

if (process.platform === 'linux' && process.env.APPIMAGE) {
  app.commandLine.appendSwitch('no-sandbox');
}

function registerMailtoProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      const registered = app.setAsDefaultProtocolClient(MAILTO_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
      registerWindowsMailtoCapabilities();
      return registered;
    }

    const registered = app.setAsDefaultProtocolClient(MAILTO_PROTOCOL);
    registerWindowsMailtoCapabilities();
    return registered;
  } catch (error) {
    console.error('Could not register mailto protocol handler:', error);
    return false;
  }
}

function writeCurrentUserRegValue(key, name, value) {
  const args = ['add', key, name ? '/v' : '/ve'];
  if (name) args.push(name);
  args.push('/t', 'REG_SZ', '/d', value, '/f');
  execFileSync('reg', args, { stdio: 'ignore', windowsHide: true });
}

function registerWindowsMailtoCapabilities() {
  if (process.platform !== 'win32') return false;

  try {
    const exePath = process.execPath;
    const command = `"${exePath}" "%1"`;

    writeCurrentUserRegValue('HKCU\\Software\\RegisteredApplications', 'MailFlow', 'Software\\Clients\\Mail\\MailFlow\\Capabilities');
    writeCurrentUserRegValue('HKCU\\Software\\Clients\\Mail\\MailFlow', '', 'MailFlow');
    writeCurrentUserRegValue('HKCU\\Software\\Clients\\Mail\\MailFlow\\Capabilities', 'ApplicationName', 'MailFlow');
    writeCurrentUserRegValue('HKCU\\Software\\Clients\\Mail\\MailFlow\\Capabilities', 'ApplicationDescription', 'A self-hosted, unified webmail client.');
    writeCurrentUserRegValue('HKCU\\Software\\Clients\\Mail\\MailFlow\\Capabilities\\URLAssociations', 'mailto', 'MailFlow.mailto');
    writeCurrentUserRegValue('HKCU\\Software\\Classes\\MailFlow.mailto', '', 'URL:MailFlow MailTo Protocol');
    writeCurrentUserRegValue('HKCU\\Software\\Classes\\MailFlow.mailto', 'URL Protocol', '');
    writeCurrentUserRegValue('HKCU\\Software\\Classes\\MailFlow.mailto\\DefaultIcon', '', `${exePath},0`);
    writeCurrentUserRegValue('HKCU\\Software\\Classes\\MailFlow.mailto\\shell\\open\\command', '', command);

    return true;
  } catch (error) {
    console.error('Could not register Windows mailto capabilities:', error);
    return false;
  }
}

function getIconPath() {
  return path.join(__dirname, 'icons', 'icon.png');
}

function getWindowIconPath() {
  if (process.platform === 'win32') return path.join(__dirname, 'icons', 'icon.ico');
  if (process.platform === 'linux') return getIconPath();
  return undefined;
}

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

function readHost() {
  try {
    const config = readConfig();
    return normalizeHost(config.host);
  } catch {
    return null;
  }
}

function writeHost(host) {
  const normalized = normalizeHost(host);
  writeConfig({ ...readConfig(), host: normalized });
  return normalized;
}

function clearHost() {
  const config = readConfig();
  delete config.host;
  writeConfig(config);
}

function getAvailableCommand(commands = []) {
  for (const command of commands) {
    try {
      const output = execFileSync('which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (output) return command;
    } catch {}
  }

  return null;
}

function emitUnityLauncherBadgeCount(count) {
  if (process.platform !== 'linux') return false;

  const gdbus = getAvailableCommand(['gdbus']);
  if (!gdbus) return false;

  const visible = count > 0;
  const properties = visible
    ? `{'count': <int64 ${count}>, 'count-visible': <true>}`
    : `{'count': <int64 0>, 'count-visible': <false>}`;

  for (const desktopId of LINUX_BADGE_DESKTOP_IDS) {
    const child = spawn(gdbus, [
      'emit',
      '--session',
      '--object-path',
      '/',
      '--signal',
      'com.canonical.Unity.LauncherEntry.Update',
      `application://${desktopId}`,
      properties,
    ], {
      detached: true,
      stdio: 'ignore',
    });

    child.unref();
  }

  return true;
}

function setUnreadBadgeCount(count) {
  let badgeSet = false;

  if (typeof app.setBadgeCount === 'function') {
    badgeSet = app.setBadgeCount(count);
  }

  return emitUnityLauncherBadgeCount(count) || badgeSet;
}

function cleanNotificationText(value, fallback = '') {
  const text = String(value || fallback)
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= NEW_MAIL_NOTIFICATION_MAX_LENGTH) return text;
  return `${text.slice(0, NEW_MAIL_NOTIFICATION_MAX_LENGTH - 1)}…`;
}

function requestMailFlowApi(url, options) {
  return session.defaultSession.cookies.get({ url: readHost() })
    .then((cookies) => sendMailFlowApiRequest(url, { ...options, cookies }));
}

function runBackgroundMailAction(action, messageId) {
  const host = readHost();
  if (!host || !messageId) return Promise.resolve();

  const encodedMessageId = encodeURIComponent(messageId);
  if (action === 'delete-message') {
    return requestMailFlowApi(`${host}/api/mail/messages/${encodedMessageId}`, {
      method: 'DELETE',
    });
  }

  if (action === 'star-message') {
    return requestMailFlowApi(`${host}/api/mail/messages/${encodedMessageId}/star`, {
      method: 'PATCH',
      body: { starred: true },
    });
  }

  return Promise.resolve();
}

function showNewMailNotification({ title, body, count, messageId, accountId, folder, message } = {}) {
  if (!Notification.isSupported()) {
    return { shown: false, reason: 'unsupported' };
  }

  const normalizedTitle = cleanNotificationText(title, 'New mail');
  const normalizedBody = cleanNotificationText(body, 'No subject');
  const notification = new Notification({
    title: normalizedTitle,
    body: count > 1 ? `${normalizedBody}\n${count} new messages` : normalizedBody,
    icon: getIconPath(),
    silent: true,
    ...(process.platform !== 'linux' ? {
      actions: [
        { type: 'button', text: 'Reply' },
        { type: 'button', text: 'Delete' },
        { type: 'button', text: 'Star' },
      ],
    } : {}),
  });

  notification.on('click', () => {
    if (messageId) {
      sendNativeAction('open-message', {
        messageId,
        accountId,
        folder,
        message,
      });
      return;
    }

    showMainWindow();
  });
  notification.on('action', (event, index) => {
    const actionIndex = Number.isInteger(index) ? index : event.actionIndex;
    if (!messageId) return;

    if (actionIndex === 0) {
      sendNativeAction('reply-message', {
        messageId,
        accountId,
        folder,
        message,
      });
      return;
    }

    const action = actionIndex === 1 ? 'delete-message' : actionIndex === 2 ? 'star-message' : null;
    if (!action) return;

    notification.close();
    runBackgroundMailAction(action, messageId)
      .catch((error) => console.error(`Could not ${action} from desktop notification:`, error));
  });
  newMailNotifications.retain(notification);
  notification.show();

  return { shown: true };
}

async function checkForUpdates(verbose = false) {
  return nativeUpdater.check(verbose);
}

function installDownloadedUpdate() {
  return Promise.resolve(nativeUpdater.install());

}

function copyLinuxUpdateCommandAndQuit({ installCommand, filePath } = {}) {
  void installCommand;
  void filePath;
  return { copied: false, reason: 'unsupported-by-custom-updater' };
}

function openDownloadedUpdatePath() {
  return nativeUpdater.openDownload();
}

function isMailtoUrl(value) {
  return /^mailto:/i.test(String(value || '').trim());
}

function parseProtocolUrlArg(args = []) {
  return args.find(isMailtoUrl) || null;
}

function splitMailtoAddresses(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendMailtoAddresses(target, value) {
  target.push(...splitMailtoAddresses(value));
}

function parseMailtoUrl(url) {
  const input = String(url || '').trim();
  if (!isMailtoUrl(input)) return null;

  try {
    const parsed = new URL(input);
    const composeData = {
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      body: '',
    };

    appendMailtoAddresses(composeData.to, decodeURIComponent(parsed.pathname || ''));

    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();

      if (normalizedKey === 'to') appendMailtoAddresses(composeData.to, value);
      else if (normalizedKey === 'cc') appendMailtoAddresses(composeData.cc, value);
      else if (normalizedKey === 'bcc') appendMailtoAddresses(composeData.bcc, value);
      else if (normalizedKey === 'subject') composeData.subject = value;
      else if (normalizedKey === 'body') composeData.body = value;
    }

    composeData.to = [...new Set(composeData.to)];
    composeData.cc = [...new Set(composeData.cc)];
    composeData.bcc = [...new Set(composeData.bcc)];

    return composeData;
  } catch (error) {
    console.error('Could not parse mailto URL:', error);
    return null;
  }
}

function sendMailtoAction(url) {
  const composeData = parseMailtoUrl(url);
  if (!composeData) return false;

  sendNativeAction('new-mail', { composeData, source: 'mailto' });
  return true;
}

function flushPendingProtocolUrls() {
  while (pendingProtocolUrls.length > 0) {
    sendMailtoAction(pendingProtocolUrls.shift());
  }
}

function parseNativeActionArg(args = []) {
  const actionArg = args.find((arg) => String(arg).startsWith(NATIVE_ACTION_ARG));
  if (!actionArg) return null;

  const action = actionArg.slice(NATIVE_ACTION_ARG.length);
  if (['new-mail', 'sync'].includes(action)) return action;
  return null;
}

function createNativeActionPayload(action, data = {}) {
  const payload = {
    ...data,
    id: nextNativeActionId,
    action,
    createdAt: Date.now(),
  };
  nextNativeActionId += 1;
  pendingNativeActions.set(payload.id, payload);
  return payload;
}

function sendNativeAction(action, data = {}) {
  if (!action) return;

  const payload = createNativeActionPayload(action, data);
  showMainWindow();

  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(NATIVE_ACTION_CHANNEL, payload);
  };

  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(send, 100);
    });
    return;
  }

  setTimeout(send, 100);
}

function nativeActionMenuItems() {
  return [
    {
      label: 'New Mail',
      click: () => sendNativeAction('new-mail'),
    },
    {
      label: 'Sync',
      click: () => sendNativeAction('sync'),
    },
  ];
}

function changeMailFlowHost() {
  clearHost();
  showMainWindow();
  loadSetup();
}

function fileMenuItems() {
  return [
    {
      label: 'Change MailFlow Host',
      accelerator: 'CmdOrCtrl+,',
      click: changeMailFlowHost,
    },
  ];
}

function editMenuItems() {
  return [
    { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
    { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
    { type: 'separator' },
    { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
    { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
    { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
    { label: 'Paste and Match Style', accelerator: 'Shift+CmdOrCtrl+V', role: 'pasteAndMatchStyle' },
    { label: 'Delete', role: 'delete' },
    { type: 'separator' },
    { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
  ];
}

function viewMenuItems() {
  return [
    {
      label: 'Reload',
      accelerator: 'CmdOrCtrl+R',
      click(_item, focusedWindow) {
        if (focusedWindow) focusedWindow.reload();
      },
    },
    {
      label: 'Toggle Full Screen',
      accelerator: process.platform === 'darwin' ? 'Ctrl+Command+F' : 'F11',
      click(_item, focusedWindow) {
        if (!focusedWindow) return;
        focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
      },
    },
  ];
}

function windowMenuItems() {
  if (process.platform === 'darwin') {
    return [
      { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
      { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
      { label: 'Zoom', role: 'zoom' },
      { type: 'separator' },
      { label: 'Bring All to Front', role: 'front' },
    ];
  }

  return [
    { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
    { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
  ];
}

function helpMenuItems() {
  return [
    {
      label: 'Learn More',
      click: () => shell.openExternal('https://github.com/YunQue0912/mailflow'),
    },
    { type: 'separator' },
    {
      label: 'Help',
      click: () => shell.openExternal('https://github.com/YunQue0912/mailflow#readme'),
    },
    {
      label: 'Report Issue',
      click: () => shell.openExternal('https://github.com/YunQue0912/mailflow/issues'),
    },
    { type: 'separator' },
    {
      label: 'Check For Updates',
      click: () => checkForUpdates(true),
    },
  ];
}

function buildDarwinMenuTemplate() {
  const name = app.name;

  return [
    {
      label: name,
      submenu: [
        { label: `About ${name}`, role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences',
          accelerator: 'Command+,',
          click: changeMailFlowHost,
        },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: `Hide ${name}`, accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Alt+H', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: `Quit ${name}`, accelerator: 'Command+Q', role: 'quit' },
      ],
    },
    {
      label: 'File',
      id: 'file',
      submenu: fileMenuItems(),
    },
    {
      label: 'Edit',
      submenu: editMenuItems(),
    },
    {
      label: 'View',
      submenu: viewMenuItems(),
    },
    {
      label: 'Window',
      role: 'window',
      submenu: windowMenuItems(),
    },
    {
      label: 'Help',
      role: 'help',
      submenu: helpMenuItems(),
    },
  ];
}

function buildDefaultMenuTemplate() {
  return [
    {
      label: 'File',
      id: 'file',
      submenu: [
        ...fileMenuItems(),
        { type: 'separator' },
        { label: 'Exit', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: editMenuItems(),
    },
    {
      label: 'View',
      submenu: viewMenuItems(),
    },
    {
      label: 'Window',
      role: 'window',
      submenu: windowMenuItems(),
    },
    {
      label: 'Help',
      role: 'help',
      submenu: helpMenuItems(),
    },
  ];
}

function setupMenu() {
  const template = process.platform === 'darwin'
    ? buildDarwinMenuTemplate()
    : buildDefaultMenuTemplate();

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showContextMenu(webContents, params) {
  const template = [];
  const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
  const hasLink = Boolean(params.linkURL);
  const hasImage = params.mediaType === 'image' && Boolean(params.srcURL);

  if (params.isEditable) {
    template.push(
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy', enabled: hasSelection },
      { label: 'Paste', role: 'paste' },
      { type: 'separator' },
      { label: 'Select All', role: 'selectAll' },
    );
  } else {
    if (hasLink) {
      template.push(
        {
          label: 'Open Link',
          click: () => {
            if (isAllowedExternalUrl(params.linkURL)) shell.openExternal(params.linkURL);
          },
        },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(params.linkURL),
        },
      );
    }

    if (hasImage) {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push({
        label: 'Copy Image Address',
        click: () => clipboard.writeText(params.srcURL),
      });
    }

    if (hasSelection) {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push(
        { label: 'Copy', role: 'copy' },
        { label: 'Select All', role: 'selectAll' },
      );
    }
  }

  if (template.length === 0) return;

  Menu.buildFromTemplate(template).popup({
    window: BrowserWindow.fromWebContents(webContents) || mainWindow,
  });
}

function getDefaultWindowBounds() {
  return {
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 620,
  };
}

function getSavedWindowBounds() {
  const bounds = readConfig().windowBounds;
  if (!bounds || typeof bounds !== 'object') return {};

  const numericBounds = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    if (Number.isFinite(bounds[key])) numericBounds[key] = bounds[key];
  }

  return numericBounds;
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  writeConfig({
    ...readConfig(),
    windowBounds: mainWindow.getBounds(),
  });
}

function showMainWindow({ reload = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  const wasHidden = !mainWindow.isVisible();

  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();

  if (reload && wasHidden) {
    mainWindow.webContents.reload();
  }
}

function getTrayIcon() {
  const trayIconPath = process.platform === 'win32'
    ? path.join(__dirname, 'icons', 'icon.ico')
    : process.platform === 'darwin'
      ? path.join(__dirname, 'icons', 'icon.icns')
      : path.join(__dirname, 'icons', '96x96.png');

  return nativeImage.createFromPath(trayIconPath);
}

function refreshTrayMenu() {
  if (!tray) return;

  const isWindowVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    ...nativeActionMenuItems(),
    { type: 'separator' },
    {
      label: isWindowVisible ? 'Hide MailFlow' : 'Show MailFlow',
      click: () => {
        if (isWindowVisible) {
          saveWindowBounds();
          mainWindow.hide();
        } else {
          showMainWindow({ reload: true });
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Change MailFlow Host',
      click: () => {
        clearHost();
        showMainWindow();
        loadSetup();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]));
}

function createTray() {
  if (tray) return;

  const trayIcon = getTrayIcon();
  if (trayIcon.isEmpty()) return;

  tray = new Tray(trayIcon);
  tray.setToolTip('MailFlow');
  tray.on('click', () => {
    refreshTrayMenu();
    showMainWindow({ reload: true });
  });
  refreshTrayMenu();
}

function setupDockMenu() {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setMenu(Menu.buildFromTemplate(nativeActionMenuItems()));
}

function setupTaskbarTasks() {
  if (process.platform !== 'win32') return;

  app.setUserTasks([
    {
      program: process.execPath,
      arguments: `${NATIVE_ACTION_ARG}new-mail`,
      iconPath: getWindowIconPath(),
      iconIndex: 0,
      title: 'New Mail',
      description: 'Compose a new MailFlow message',
    },
    {
      program: process.execPath,
      arguments: `${NATIVE_ACTION_ARG}sync`,
      iconPath: getWindowIconPath(),
      iconIndex: 0,
      title: 'Sync',
      description: 'Sync MailFlow mail',
    },
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...getDefaultWindowBounds(),
    ...getSavedWindowBounds(),
    show: false,
    title: 'MailFlow',
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });

  configureWindowOpening(mainWindow.webContents, {
    getHost: readHost,
    isAllowedExternalUrl,
    openExternal: (url) => shell.openExternal(url),
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    showContextMenu(mainWindow.webContents, params);
  });

  const navigationPolicy = createNavigationPolicy(readHost);
  const internalPages = new Set([
    pathToFileURL(path.join(__dirname, '..', 'native-shell', 'index.html')).toString(),
    pathToFileURL(path.join(__dirname, '..', 'native-shell', 'host-unavailable.html')).toString(),
  ]);
  const guardNavigation = (event, url, kind) => {
    if (internalPages.has(url)) {
      navigationPolicy.reset();
      return;
    }
    if (navigationPolicy.decide(kind, url) === 'allow') return;
    event.preventDefault();
  };

  mainWindow.webContents.on('will-navigate', (event, url) => {
    guardNavigation(event, url, 'navigate');
  });
  mainWindow.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    guardNavigation(event, url, 'redirect');
  });

  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    const host = readHost();
    if (!host || !isSameOrigin(host, validatedURL)) return;
    loadHostUnavailable();
  });

  mainWindow.webContents.session.webRequest.onCompleted((details) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (details.webContentsId !== mainWindow.webContents.id) return;
    if (details.resourceType !== 'mainFrame') return;
    if (!HOST_UNAVAILABLE_STATUS_CODES.has(details.statusCode)) return;

    const host = readHost();
    if (!host || !isSameOrigin(host, details.url)) return;

    setTimeout(() => loadHostUnavailable(), 0);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    detectRewriteErrorPage();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      saveWindowBounds();
      mainWindow.hide();
      refreshTrayMenu();
      return;
    }

    saveWindowBounds();
  });

  mainWindow.on('show', refreshTrayMenu);
  mainWindow.on('hide', refreshTrayMenu);
  mainWindow.on('closed', () => {
    mainWindow = null;
    refreshTrayMenu();
  });

  nativeUpdater.initialize();

  const host = readHost();
  if (host) {
    mainWindow.loadURL(host);
  } else {
    loadSetup();
  }
}

function loadSetup() {
  if (!mainWindow) return;
  mainWindow.loadFile(path.join(__dirname, '..', 'native-shell', 'index.html'));
}

function loadHostUnavailable() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadFile(path.join(__dirname, '..', 'native-shell', 'host-unavailable.html'));
}

function detectRewriteErrorPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentUrl = mainWindow.webContents.getURL();
  const host = readHost();
  if (!host || !isSameOrigin(host, currentUrl)) return;

  mainWindow.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true)
    .then((text) => {
      if (!REWRITE_ERROR_PATTERNS.some((pattern) => pattern.test(String(text || '')))) return;
      loadHostUnavailable();
    })
    .catch(() => {});
}

ipcMain.handle('mailflow:getHost', () => readHost());

ipcMain.handle('mailflow:saveHost', async (_event, host) => {
  const normalized = normalizeHost(host);
  if (new URL(normalized).protocol === 'http:') {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Use unencrypted connection', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Unencrypted MailFlow connection',
      message: 'Traffic to this MailFlow server is not encrypted.',
      detail: 'Your session cookie and email data can be read or changed by anyone who can observe this network. Continue only on a private network you trust.',
    });
    if (result.response !== 0) {
      throw new Error('The unencrypted MailFlow host was not saved.');
    }
  }

  writeHost(normalized);
  return normalized;
});

ipcMain.handle('mailflow:resetHost', () => {
  clearHost();
  loadSetup();
});

ipcMain.handle('mailflow:badge:set-unread-count', (_event, count) => {
  const unreadCount = Math.max(0, Number.parseInt(count, 10) || 0);
  return setUnreadBadgeCount(unreadCount);
});

ipcMain.handle('mailflow:notification:new-mail', (_event, notification) => {
  return showNewMailNotification(notification);
});

ipcMain.handle('mailflow:updates:check', async (_event, { verbose } = {}) => {
  return checkForUpdates(verbose);
});

ipcMain.handle('mailflow:updates:get-state', () => nativeUpdater.getState());

ipcMain.handle('mailflow:updates:download', () => nativeUpdater.download());

ipcMain.handle('mailflow:updates:cancel', () => nativeUpdater.cancel());

ipcMain.handle('mailflow:updates:install-downloaded', () => {
  return installDownloadedUpdate();
});

ipcMain.handle('mailflow:updates:install-auto', () => {
  return installDownloadedUpdate();
});

ipcMain.handle('mailflow:updates:copy-install-command-and-quit', (_event, options) => {
  return copyLinuxUpdateCommandAndQuit(options);
});

ipcMain.handle('mailflow:updates:open-download', () => {
  openDownloadedUpdatePath();
});

ipcMain.handle('mailflow:native-actions:pending', () => {
  return Array.from(pendingNativeActions.values());
});

ipcMain.handle('mailflow:native-actions:ack', (_event, id) => {
  pendingNativeActions.delete(id);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    registerMailtoProtocol();
    setupMenu();
    setupDockMenu();
    setupTaskbarTasks();
    createTray();
    createWindow();
    sendNativeAction(parseNativeActionArg(process.argv));
    sendMailtoAction(parseProtocolUrlArg(process.argv));
    flushPendingProtocolUrls();

    app.on('activate', () => {
      showMainWindow();
    });
  });

  app.on('second-instance', (_event, args) => {
    const mailtoUrl = parseProtocolUrlArg(args);
    if (mailtoUrl) {
      sendMailtoAction(mailtoUrl);
      return;
    }

    showMainWindow();
    sendNativeAction(parseNativeActionArg(args));
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  destroyTray();
});

app.on('open-url', (event, url) => {
  event.preventDefault();

  if (mainWindow) {
    sendMailtoAction(url);
    return;
  }

  pendingProtocolUrls.push(url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
