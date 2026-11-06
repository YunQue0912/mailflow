// Clipboard behavior belongs to this device and this MailFlow user, rather than
// to the account's synced preferences. No mail text or codes are stored here.
export const VERIFICATION_CODE_PREFERENCES_EVENT = 'mailflow:verification-code-preferences';
const KEY_PREFIX = 'mailflow_auto_copy_verification_codes:';

function storageKey(userId) {
  if ((typeof userId !== 'string' && typeof userId !== 'number') || String(userId).trim() === '') return null;
  return `${KEY_PREFIX}${userId}`;
}

export function getAutoCopyVerificationCodes(userId) {
  const key = storageKey(userId);
  if (!key) return false;
  try { return globalThis.localStorage?.getItem(key) === '1'; }
  catch { return false; }
}

export function setAutoCopyVerificationCodes(userId, enabled) {
  const key = storageKey(userId);
  if (!key) return;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (enabled === true) storage.setItem(key, '1');
    else storage.removeItem(key);
  } catch { return; }
  const win = globalThis.window;
  if (win?.dispatchEvent && win.Event) win.dispatchEvent(new win.Event(VERIFICATION_CODE_PREFERENCES_EVENT));
}
