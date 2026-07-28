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
