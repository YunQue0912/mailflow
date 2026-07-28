import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callAndroidJavascriptInterface,
  pollAndroidUpdateState,
} from './capacitorNativeBridge.js';

test('reads structured update state from the Android JavaScript interface', () => {
  const target = {
    MailFlowAndroid: {
      getUpdateState: () => JSON.stringify({
        type: 'idle',
        currentVersion: '2.8.0-custom.3',
      }),
    },
  };

  assert.deepEqual(callAndroidJavascriptInterface(target, 'getUpdateState', [], null), {
    available: true,
    value: { type: 'idle', currentVersion: '2.8.0-custom.3' },
  });
});

test('reports a missing Android method so the Capacitor fallback can run', () => {
  assert.deepEqual(callAndroidJavascriptInterface({}, 'getUpdateState', [], { type: 'idle' }), {
    available: false,
    value: { type: 'idle' },
  });
});

test('contains malformed native results and preserves a usable fallback', () => {
  const target = { MailFlowAndroid: { getUpdateState: () => '{invalid' } };
  assert.deepEqual(callAndroidJavascriptInterface(target, 'getUpdateState', [], { type: 'idle' }), {
    available: true,
    value: { type: 'idle' },
  });
});

test('polls the direct Android bridge until an update state is available', async () => {
  const states = [
    { type: 'checking', currentVersion: '2.8.0-custom.3' },
    {
      type: 'available',
      currentVersion: '2.8.0-custom.3',
      data: { version: '2.8.0-custom.5' },
    },
  ];
  const observed = [];
  const target = {
    MailFlowAndroid: {
      getUpdateState: () => JSON.stringify(states.shift() || states.at(-1)),
    },
  };

  const result = await pollAndroidUpdateState(target, {
    onStatus: (status) => observed.push(status),
    wait: async () => {},
    maxAttempts: 3,
  });

  assert.deepEqual(observed, [
    { type: 'checking', currentVersion: '2.8.0-custom.3' },
    {
      type: 'available',
      currentVersion: '2.8.0-custom.3',
      data: { version: '2.8.0-custom.5' },
      version: '2.8.0-custom.5',
    },
  ]);
  assert.equal(result.type, 'available');
  assert.equal(result.version, '2.8.0-custom.5');
});

test('returns null when the direct Android bridge never leaves idle', async () => {
  const target = {
    MailFlowAndroid: {
      getUpdateState: () => JSON.stringify({
        type: 'idle',
        currentVersion: '2.8.0-custom.3',
      }),
    },
  };

  const result = await pollAndroidUpdateState(target, {
    wait: async () => {},
    maxAttempts: 2,
  });

  assert.equal(result, null);
});
