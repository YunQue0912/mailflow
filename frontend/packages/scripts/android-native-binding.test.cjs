'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const mainActivity = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'android',
    'app',
    'src',
    'main',
    'java',
    'sh',
    'mailflow',
    'app',
    'MainActivity.java',
  ),
  'utf8',
);
const nativePlugin = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'android',
    'app',
    'src',
    'main',
    'java',
    'sh',
    'mailflow',
    'app',
    'MailFlowNativePlugin.java',
  ),
  'utf8',
);

test('resolves the Android update plugin lazily after Capacitor creates its bridge', () => {
  const registerIndex = mainActivity.indexOf('registerPlugin(MailFlowNativePlugin.class);');
  const createIndex = mainActivity.indexOf('super.onCreate(savedInstanceState);');

  assert.ok(registerIndex >= 0 && registerIndex < createIndex);
  assert.match(
    mainActivity,
    /new MailFlowNativePlugin\.NativePluginProvider\(\)/,
  );
  assert.match(
    mainActivity,
    /return resolveNativePlugin\(\);/,
  );
  assert.match(
    mainActivity,
    /PluginHandle handle = bridge\.getPlugin\("MailFlowNative"\);/,
  );
  assert.match(
    mainActivity,
    /if \(plugin == null\) plugin = handle\.load\(\);/,
  );
  assert.doesNotMatch(
    mainActivity,
    /private final MailFlowNativePlugin nativePlugin = new MailFlowNativePlugin\(\);/,
  );
  assert.doesNotMatch(mainActivity, /bridgeBuilder\.addPluginInstance/);
});

test('does not access the Capacitor context while constructing the native plugin', () => {
  assert.match(
    nativePlugin,
    /private volatile JSObject lastUpdateStatus = null;/,
  );
  assert.doesNotMatch(
    nativePlugin,
    /lastUpdateStatus\s*=\s*updateStatus\("idle"\)/,
  );
  assert.match(
    nativePlugin,
    /public void load\(\)[\s\S]*lastUpdateStatus = downloadedUpdate/,
  );
});

test('discards a persisted Android update after that version has been installed', () => {
  assert.match(
    nativePlugin,
    /restoreDownloadedUpdateState\(\)[\s\S]*!isPersistedUpdateNewer\([\s\S]*updateInfo\.version,[\s\S]*updateInfo\.versionCode,[\s\S]*getInstalledVersion\(\),[\s\S]*getInstalledVersionCode\(\)[\s\S]*clearDownloadedUpdateState\(\);/,
  );
  assert.match(
    nativePlugin,
    /private void clearDownloadedUpdateState\(\)[\s\S]*downloadedUpdate = null;[\s\S]*updateInfo = null;/,
  );
});
