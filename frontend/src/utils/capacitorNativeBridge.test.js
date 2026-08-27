import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callAndroidJavascriptInterface,
  callAndroidMessageBridge,
  installCapacitorNativeBridge,
  pollAndroidUpdateState,
  subscribeNativePluginEvent,
} from './capacitorNativeBridge.js';

test('routes update calls through the origin-scoped Android message bridge', async () => {
  const target = {
    MailFlowAndroid: {
      postMessage(payload) {
        const request = JSON.parse(payload);
        queueMicrotask(() => this.onmessage({
          data: JSON.stringify({
            id: request.id,
            result: { started: true, method: request.method, verbose: request.args.verbose },
          }),
        }));
      },
    },
  };

  const result = await callAndroidMessageBridge(
    target,
    'checkForUpdates',
    { verbose: true },
    { started: false },
  );

  assert.deepEqual(result, {
    available: true,
    value: { started: true, method: 'checkForUpdates', verbose: true },
  });
});

test('reports a missing Android message bridge so Capacitor can remain the fallback', async () => {
  assert.deepEqual(
    await callAndroidMessageBridge({}, 'getUpdateState', {}, { type: 'idle' }),
    { available: false, value: { type: 'idle' } },
  );
});

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

test('polls update state through the asynchronous Android message bridge', async () => {
  const states = [
    { type: 'checking', currentVersion: '2.9.0-custom.1' },
    { type: 'available', currentVersion: '2.9.0-custom.1', version: '3.3.0-custom.2' },
  ];
  const observed = [];

  const result = await pollAndroidUpdateState({}, {
    readState: async () => states.shift() || states.at(-1),
    onStatus: (status) => observed.push(status),
    wait: async () => {},
    maxAttempts: 3,
  });

  assert.deepEqual(observed, [
    { type: 'checking', currentVersion: '2.9.0-custom.1' },
    { type: 'available', currentVersion: '2.9.0-custom.1', version: '3.3.0-custom.2' },
  ]);
  assert.equal(result.type, 'available');
});

test('native action subscription is a safe no-op without a Capacitor plugin proxy', () => {
  assert.doesNotThrow(() => {
    const unsubscribe = subscribeNativePluginEvent(null, 'nativeAction', () => {});
    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
  });
});

test('native action subscription contains synchronous plugin lookup failures', () => {
  assert.doesNotThrow(() => {
    const unsubscribe = subscribeNativePluginEvent(
      () => {
        throw new TypeError('registerNativePlugin is not a function');
      },
      'nativeAction',
      () => {},
    );
    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
  });
});

test('Android JavaScript interface can mount post-login action listeners without Capacitor', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    MailFlowAndroid: {},
    Capacitor: {},
  });

  try {
    assert.equal(await installCapacitorNativeBridge(), true);
    assert.doesNotThrow(() => {
      const unsubscribe = globalThis.window.mailflowNative.actions.onAction(() => {});
      assert.equal(typeof unsubscribe, 'function');
      unsubscribe();
    });
  } finally {
    globalThis.window = originalWindow;
  }
});
