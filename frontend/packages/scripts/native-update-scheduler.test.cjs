'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const notificationBridge = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'ElectronNotificationBridge.jsx'),
  'utf8',
);

test('forces exactly one automatic update check for each app run session', () => {
  assert.match(
    notificationBridge,
    /sessionStorage\.getItem\(NATIVE_UPDATE_KEYS\.sessionCheck\) === 'true'[\s\S]*scheduleNextCheck\(\);[\s\S]*runAutomaticCheck\(\{ force: true, markSession: true \}\);/,
  );
  assert.match(
    notificationBridge,
    /if \(markSession\) \{[\s\S]*sessionStorage\.setItem\(NATIVE_UPDATE_KEYS\.sessionCheck, 'true'\);/,
  );
});

test('does not treat foreground and network recovery as a new app session', () => {
  assert.match(
    notificationBridge,
    /document\.addEventListener\('visibilitychange', checkWhenVisible\);/,
  );
  assert.match(
    notificationBridge,
    /window\.addEventListener\('online', runAutomaticCheck\);/,
  );
  assert.doesNotMatch(
    notificationBridge,
    /window\.addEventListener\('online', checkAfterAutoUpdateEnabled\);/,
  );
});
