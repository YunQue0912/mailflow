export const NATIVE_UPDATE_KEYS = Object.freeze({
  autoCheck: 'mailflow-native-auto-update',
  deferredUntil: 'mailflow-native-update-deferred-until',
  deferredVersion: 'mailflow-native-update-deferred-version',
  lastCheck: 'mailflow-native-last-update-check',
  skippedVersion: 'mailflow-native-skipped-version',
});

export const NATIVE_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isNativeAppEnvironment(target = globalThis.window) {
  if (target?.mailflowNative?.updates) return true;
  const capacitor = target?.Capacitor;
  if (typeof capacitor?.isNativePlatform === 'function') return capacitor.isNativePlatform();
  if (typeof capacitor?.getPlatform === 'function') return capacitor.getPlatform() !== 'web';
  return false;
}

export function shouldRunAutomaticNativeUpdateCheck({ autoCheck, lastCheck, now = Date.now() }) {
  if (autoCheck === false) return false;
  const previousCheck = Number(lastCheck || 0);
  return !Number.isFinite(previousCheck) || now - previousCheck >= NATIVE_UPDATE_CHECK_INTERVAL_MS;
}

export function shouldRecordNativeUpdateCheck(result) {
  return Boolean(result) && !result.error && result.state?.type !== 'error';
}

export function resolveNativeUpdateDisplayType(status, suppression, now = Date.now()) {
  const type = status?.type || 'idle';
  if (type !== 'available' || !status.version) return type;
  if (suppression.skippedVersion === status.version) return 'skipped';
  if (suppression.deferredVersion === status.version && now < Number(suppression.deferredUntil || 0)) {
    return 'deferred';
  }
  return type;
}
