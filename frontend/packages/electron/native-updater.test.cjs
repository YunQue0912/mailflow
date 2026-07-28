'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createNativeUpdater } = require('./native-updater.cjs');

function createHarness() {
  const updater = new EventEmitter();
  const sent = [];
  let prepared = 0;
  let installed = 0;
  let forcedExit = 0;
  let scheduledExit = null;
  updater.checkForUpdates = async () => ({ updateInfo: { version: '2.8.0-custom.3' } });
  updater.downloadUpdate = async () => [];
  updater.quitAndInstall = () => { installed += 1; };

  const nativeUpdater = createNativeUpdater({
    app: { getVersion: () => '2.8.0-custom.2', isPackaged: true },
    shell: { openExternal: async () => {} },
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (_channel, state) => sent.push(state) },
    }),
    updater,
    createCancellationToken: () => ({ cancel() {}, cancelled: false }),
    prepareToInstall: () => { prepared += 1; },
    forceExit: () => { forcedExit += 1; },
    scheduleForceExit: (callback) => { scheduledExit = callback; },
  });

  return {
    get installed() { return installed; },
    get forcedExit() { return forcedExit; },
    nativeUpdater,
    get prepared() { return prepared; },
    runScheduledExit() { scheduledExit?.(); },
    sent,
    updater,
  };
}

test('checking and downloading never start the installer', async () => {
  const harness = createHarness();
  harness.nativeUpdater.initialize();
  harness.updater.checkForUpdates = async () => {
    harness.updater.emit('checking-for-update');
    harness.updater.emit('update-available', { version: '2.8.0-custom.3' });
    return { updateInfo: { version: '2.8.0-custom.3' } };
  };

  const result = await harness.nativeUpdater.check(true);
  assert.equal(result.updateAvailable, true);
  assert.equal(harness.prepared, 0);
  assert.equal(harness.installed, 0);
  assert.equal(harness.nativeUpdater.getState().type, 'available');
});

test('installation prepares the application before starting NSIS', async () => {
  const harness = createHarness();
  harness.nativeUpdater.initialize();
  harness.updater.emit('update-downloaded', { version: '2.8.0-custom.3' });

  assert.deepEqual(harness.nativeUpdater.install(), { installed: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.prepared, 1);
  assert.equal(harness.installed, 1);
  assert.equal(harness.forcedExit, 0);
  assert.equal(harness.nativeUpdater.getState().type, 'installing');

  harness.runScheduledExit();
  assert.equal(harness.forcedExit, 1);
});

test('duplicate install requests are rejected', async () => {
  const harness = createHarness();
  harness.nativeUpdater.initialize();
  harness.updater.emit('update-downloaded', { version: '2.8.0-custom.3' });

  assert.deepEqual(harness.nativeUpdater.install(), { installed: true });
  assert.deepEqual(harness.nativeUpdater.install(), { installed: false, reason: 'already-installing' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.installed, 1);
});
