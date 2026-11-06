import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) {
      return { format: 'module', shortCircuit: true, source: `
        export const useTranslation = () => ({
          t: (key, values) => key === 'verificationCodes.copyLabel' ? 'Copy code ' + values.code : key,
        });
      ` };
    }
    if (url.endsWith('/src/store/index.js')) {
      return { format: 'module', shortCircuit: true, source: `
        import { useSyncExternalStore } from 'react';
        let state = { user: { id: 'u1' }, isLocked: false };
        const listeners = new Set();
        const subscribe = callback => { listeners.add(callback); return () => listeners.delete(callback); };
        export const useStore = selector => useSyncExternalStore(subscribe, () => selector(state));
        useStore.getState = () => state;
        useStore.subscribe = subscribe;
        useStore.setState = patch => { const previous = state; state = { ...state, ...patch }; for (const listener of listeners) listener(state, previous); };
      ` };
    }
    if (url.endsWith('.jsx')) {
      return {
        format: 'module', shortCircuit: true,
        source: transform(readFileSync(new URL(url), 'utf8'), {
          transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url,
        }).code,
      };
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM('<div id="root"></div>', {
  url: 'https://mail.example.invalid', pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
});
let writeText;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: {
    userAgent: dom.window.navigator.userAgent,
    clipboard: { writeText: value => writeText(value) },
  },
});

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useStore } = await import('../store/index.js');
const { default: VerificationCodeNotice } = await import('./VerificationCodeNotice.jsx');
let root = createRoot(document.getElementById('root'));
let writes;
const firstMessage = { id: 'm1', subject: 'Your verification code is 001234' };

async function render(props = {}) {
  await React.act(async () => root.render(React.createElement(VerificationCodeNotice, {
    message: firstMessage, ...props,
  })));
}

async function click(index = 0) {
  await React.act(async () => document.querySelectorAll('button')[index].click());
}

beforeEach(async () => {
  await React.act(async () => root.unmount());
  root = createRoot(document.getElementById('root'));
  writes = [];
  writeText = async value => { writes.push(value); };
  document.execCommand = undefined;
  document.getSelection().removeAllRanges();
  useStore.setState({ user: { id: 'u1' }, isLocked: false });
});

after(async () => {
  await React.act(async () => root.unmount());
  dom.window.close();
});

describe('verification code notice', () => {
  test('shows and copies the subject code without losing leading zeroes', async () => {
    await render();
    assert.equal(document.querySelector('code').textContent, '001234');
    const button = document.querySelector('button');
    assert.equal(button.type, 'button');
    assert.equal(button.getAttribute('aria-label'), 'Copy code 001234');
    assert.equal(document.querySelector('[role="status"]'), null);
    await click();
    assert.deepEqual(writes, ['001234']);
    assert.equal(document.querySelector('[role="status"]').textContent, 'verificationCodes.copied');
  });

  test('offers separate copy controls for multiple explicit codes', async () => {
    await render({ body: { text: 'Your backup verification code is 987654.' } });
    assert.equal(document.querySelectorAll('button').length, 2);
    await click(1);
    assert.deepEqual(writes, ['987654']);
  });

  test('does not render for ordinary mail or expose a notification live region', async () => {
    await render({ message: { id: 'ordinary', subject: 'Order 123456 shipped' }, body: { text: 'Thank you.' } });
    assert.equal(document.getElementById('root').textContent, '');
    assert.equal(document.querySelector('[aria-live]'), null);
  });

  test('picks up a code supplied only by the loaded HTML body', async () => {
    await render({
      message: { id: 'html', subject: 'Please sign in' },
      body: { html: '<p>Your verification code is <b>654321</b>.</p>' },
    });
    assert.equal(document.querySelector('code').textContent, '654321');
  });

  test('selects the visible code and explains a failed copy', async () => {
    writeText = async () => { throw new Error('Permission denied'); };
    await render();
    await click();
    assert.equal(document.querySelector('[role="alert"]').textContent, 'verificationCodes.copyFailed');
    assert.equal(String(document.getSelection()), '001234');
    assert.equal(document.querySelector('[role="status"]'), null);
  });

  test('resets copied feedback when moving to another message with the same code', async () => {
    await render();
    await click();
    await render({ message: { ...firstMessage, id: 'm2' } });
    assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(document.querySelector('button').textContent, 'verificationCodes.copy');
  });

  test('does not report a completed copy to a different user', async () => {
    let finish;
    writeText = () => new Promise(resolve => { finish = resolve; });
    await render();
    await click();
    await React.act(async () => useStore.setState({ user: { id: 'u2' } }));
    await React.act(async () => finish());
    assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(document.querySelector('button').disabled, false);
  });

  test('hides the code when locked and ignores completion after lock', async () => {
    let finish;
    writeText = () => new Promise(resolve => { finish = resolve; });
    await render();
    await click();
    await React.act(async () => useStore.setState({ isLocked: true }));
    await React.act(async () => finish());
    assert.equal(document.getElementById('root').textContent, '');
    await React.act(async () => useStore.setState({ isLocked: false }));
    assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(document.querySelector('button').disabled, false);
  });

  test('ignores clipboard completion after unmount', async () => {
    let finish;
    writeText = () => new Promise(resolve => { finish = resolve; });
    await render();
    await click();
    await React.act(async () => root.render(null));
    await React.act(async () => finish());
    assert.equal(document.getElementById('root').textContent, '');
  });

  test('does not run legacy fallback after a pending copy rejects in a later locked session', async () => {
    let reject;
    writeText = () => new Promise((_resolve, fail) => { reject = fail; });
    let fallbacks = 0;
    document.execCommand = () => { fallbacks++; return true; };
    await render();
    await click();
    await React.act(async () => {
      useStore.setState({ isLocked: true });
      useStore.setState({ isLocked: false });
      reject(new Error('Permission denied'));
    });
    assert.equal(fallbacks, 0);
    assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(document.querySelector('button').disabled, false);
  });

  test('does not run legacy fallback after signing out and back in as the same user', async () => {
    let reject;
    writeText = () => new Promise((_resolve, fail) => { reject = fail; });
    let fallbacks = 0;
    document.execCommand = () => { fallbacks++; return true; };
    await render();
    await click();
    await React.act(async () => {
      useStore.setState({ user: null });
      useStore.setState({ user: { id: 'u1' } });
      reject(new Error('Permission denied'));
    });
    assert.equal(fallbacks, 0);
    assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(document.querySelector('[role="alert"]'), null);
  });

  test('compact notification copies without activating the parent notification', async () => {
    let opened = 0;
    await React.act(async () => root.render(React.createElement('div', { onClick: () => opened++ },
      React.createElement(VerificationCodeNotice, { message: firstMessage, compact: true }))));
    await click();
    assert.deepEqual(writes, ['001234']);
    assert.equal(opened, 0);
  });
});
