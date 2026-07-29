export const NATIVE_UPDATE_KEYS = Object.freeze({
  autoCheck: 'mailflow-native-auto-update',
  deferredUntil: 'mailflow-native-update-deferred-until',
  deferredVersion: 'mailflow-native-update-deferred-version',
  lastCheck: 'mailflow-native-last-update-check',
  sessionCheck: 'mailflow-native-session-update-check',
  skippedVersion: 'mailflow-native-skipped-version',
});

export const NATIVE_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const NATIVE_UPDATE_RETRY_INTERVAL_MS = 15 * 60 * 1000;

export function normalizeIntlLocale(locale) {
  const value = String(locale || '').trim();
  if (!value) return 'en';
  if (/^[a-z]{2}[A-Z]{2}$/.test(value)) {
    return `${value.slice(0, 2)}-${value.slice(2)}`;
  }

  try {
    Intl.getCanonicalLocales(value);
    return value;
  } catch {
    return 'en';
  }
}

export function formatNativeUpdateReleaseDate(value, locale) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat(normalizeIntlLocale(locale), { dateStyle: 'medium' }).format(date);
}

export function isNativeAppEnvironment(target = globalThis.window) {
  if (target?.mailflowNative?.updates || target?.MailFlowAndroid) return true;
  const capacitor = target?.Capacitor;
  if (typeof capacitor?.isNativePlatform === 'function') return capacitor.isNativePlatform();
  if (typeof capacitor?.getPlatform === 'function') return capacitor.getPlatform() !== 'web';
  return false;
}

export function shouldRunAutomaticNativeUpdateCheck({
  autoCheck,
  force = false,
  lastCheck,
  now = Date.now(),
}) {
  if (autoCheck === false) return false;
  if (force) return true;
  const previousCheck = Number(lastCheck || 0);
  return !Number.isFinite(previousCheck) || now - previousCheck >= NATIVE_UPDATE_CHECK_INTERVAL_MS;
}

export function shouldRecordNativeUpdateCheck(result) {
  if (!result || result.error) return false;
  return ['up-to-date', 'available', 'downloaded'].includes(result.state?.type);
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
