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

test('checks the stable manifest directly without the rate-limited GitHub API', () => {
  assert.match(
    nativePlugin,
    /releases\/latest\/download\/update-manifest\.json/,
  );
  assert.doesNotMatch(
    nativePlugin,
    /api\.github\.com\/repos\/YunQue0912\/mailflow\/releases\/latest/,
  );
  assert.match(
    nativePlugin,
    /assetName\.matches\("\[A-Za-z0-9\._-\]\+\\\\\.apk"\)/,
  );
  assert.match(
    nativePlugin,
    /compiledCertificate\.equals\(info\.certificateSha256\)/,
  );
});
