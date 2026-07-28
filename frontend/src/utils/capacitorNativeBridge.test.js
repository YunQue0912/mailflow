import assert from 'node:assert/strict';
import test from 'node:test';
import { callAndroidJavascriptInterface } from './capacitorNativeBridge.js';

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
