import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatNativeUpdateReleaseDate,
  isNativeAppEnvironment,
  NATIVE_UPDATE_CHECK_INTERVAL_MS,
  normalizeIntlLocale,
  resolveNativeUpdateDisplayType,
  shouldRecordNativeUpdateCheck,
  shouldRunAutomaticNativeUpdateCheck,
} from './nativeUpdatePolicy.js';

test('native release dates accept the app language codes without crashing the page', () => {
  assert.equal(normalizeIntlLocale('zhCN'), 'zh-CN');
  assert.equal(normalizeIntlLocale('not_a_locale'), 'en');
  assert.match(formatNativeUpdateReleaseDate('2026-07-29T00:00:00.000Z', 'zhCN'), /2026/);
  assert.equal(formatNativeUpdateReleaseDate('not-a-date', 'zhCN'), null);
});

test('server update notices are suppressed in Electron and Capacitor native apps', () => {
  assert.equal(isNativeAppEnvironment({ mailflowNative: { updates: {} } }), true);
  assert.equal(isNativeAppEnvironment({ Capacitor: { isNativePlatform: () => true } }), true);
  assert.equal(isNativeAppEnvironment({ Capacitor: { getPlatform: () => 'android' } }), true);
  assert.equal(isNativeAppEnvironment({ Capacitor: { getPlatform: () => 'web' } }), false);
  assert.equal(isNativeAppEnvironment({}), false);
});

test('automatic update checks are enabled by default and throttled for 24 hours', () => {
  const now = 1_000_000_000;
  assert.equal(shouldRunAutomaticNativeUpdateCheck({ autoCheck: true, lastCheck: 0, now }), true);
  assert.equal(shouldRunAutomaticNativeUpdateCheck({ autoCheck: false, lastCheck: 0, now }), false);
  assert.equal(shouldRunAutomaticNativeUpdateCheck({ autoCheck: true, lastCheck: now - 1000, now }), false);
  assert.equal(shouldRunAutomaticNativeUpdateCheck({
    autoCheck: true,
    lastCheck: now - NATIVE_UPDATE_CHECK_INTERVAL_MS,
    now,
  }), true);
});

test('failed native checks are not recorded as successful throttle points', () => {
  assert.equal(shouldRecordNativeUpdateCheck(undefined), false);
  assert.equal(shouldRecordNativeUpdateCheck({ error: 'update-check-failed' }), false);
  assert.equal(shouldRecordNativeUpdateCheck({ state: { type: 'error' } }), false);
  assert.equal(shouldRecordNativeUpdateCheck({ updateAvailable: false, state: { type: 'up-to-date' } }), true);
  assert.equal(shouldRecordNativeUpdateCheck({ updateAvailable: true }), true);
});

test('skip and defer suppression only apply to the matching release', () => {
  const status = { type: 'available', version: '2.7.1-custom.5' };
  assert.equal(resolveNativeUpdateDisplayType(status, {
    skippedVersion: status.version,
    deferredVersion: '',
    deferredUntil: 0,
  }), 'skipped');
  assert.equal(resolveNativeUpdateDisplayType(status, {
    skippedVersion: '',
    deferredVersion: status.version,
    deferredUntil: 200,
  }, 100), 'deferred');
  assert.equal(resolveNativeUpdateDisplayType(status, {
    skippedVersion: '2.7.1-custom.4',
    deferredVersion: '2.7.1-custom.4',
    deferredUntil: 200,
  }, 100), 'available');
  assert.equal(resolveNativeUpdateDisplayType(status, {
    skippedVersion: '',
    deferredVersion: status.version,
    deferredUntil: 100,
  }, 100), 'available');
});
