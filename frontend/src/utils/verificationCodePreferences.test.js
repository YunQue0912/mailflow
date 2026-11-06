import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAutoCopyVerificationCodes, setAutoCopyVerificationCodes, VERIFICATION_CODE_PREFERENCES_EVENT,
} from './verificationCodePreferences.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let entries;
let events;

beforeEach(() => {
  entries = new Map();
  events = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  } });
  const window = new EventTarget();
  window.Event = Event;
  window.addEventListener(VERIFICATION_CODE_PREFERENCES_EVENT, () => events++);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globalThis.localStorage;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
});

test('auto-copy defaults off and stays scoped to the current MailFlow user', () => {
  assert.equal(getAutoCopyVerificationCodes('a'), false);
  setAutoCopyVerificationCodes('a', true);
  assert.equal(getAutoCopyVerificationCodes('a'), true);
  assert.equal(getAutoCopyVerificationCodes('b'), false);
  assert.deepEqual([...entries.values()], ['1'], 'only the preference is persisted');
  assert.equal(events, 1);
  setAutoCopyVerificationCodes('a', false);
  assert.equal(getAutoCopyVerificationCodes('a'), false);
  assert.equal(entries.size, 0);
  assert.equal(events, 2);
});

test('a signed-out user cannot enable or inherit auto-copy', () => {
  for (const id of [undefined, null, '', ' ', {}]) {
    setAutoCopyVerificationCodes(id, true);
    assert.equal(getAutoCopyVerificationCodes(id), false);
  }
  assert.equal(entries.size, 0);
  assert.equal(events, 0);
});

test('unavailable or blocked local storage fails closed without throwing', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  assert.equal(getAutoCopyVerificationCodes('a'), false);
  assert.doesNotThrow(() => setAutoCopyVerificationCodes('a', true));
  assert.equal(events, 0);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  assert.equal(getAutoCopyVerificationCodes('a'), false);
  assert.doesNotThrow(() => setAutoCopyVerificationCodes('a', true));
  assert.equal(events, 0);
});
