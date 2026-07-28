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

test('binds the direct Android bridge to the same eagerly registered plugin instance', () => {
  const registerIndex = mainActivity.indexOf('bridgeBuilder.addPluginInstance(nativePlugin);');
  const createIndex = mainActivity.indexOf('super.onCreate(savedInstanceState);');

  assert.match(
    mainActivity,
    /private final MailFlowNativePlugin nativePlugin = new MailFlowNativePlugin\(\);/,
  );
  assert.ok(registerIndex >= 0 && registerIndex < createIndex);
  assert.match(
    mainActivity,
    /new MailFlowNativePlugin\.NotificationBridge\(this, nativePlugin\)/,
  );
  assert.doesNotMatch(mainActivity, /registerPlugin\(MailFlowNativePlugin\.class\)/);
  assert.doesNotMatch(mainActivity, /bridge\.getPlugin\("MailFlowNative"\)/);
});
