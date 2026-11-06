import { useSyncExternalStore } from 'react';
import { useStore } from '../store/index.js';
import {
  getAutoCopyVerificationCodes, setAutoCopyVerificationCodes,
  VERIFICATION_CODE_PREFERENCES_EVENT,
} from '../utils/verificationCodePreferences.js';

function subscribe(onChange) {
  window.addEventListener(VERIFICATION_CODE_PREFERENCES_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(VERIFICATION_CODE_PREFERENCES_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useVerificationCodePreferences() {
  const userId = useStore(s => s.user?.id);
  const enabled = useSyncExternalStore(subscribe,
    () => getAutoCopyVerificationCodes(userId), () => false);
  return {
    enabled,
    available: Boolean(userId),
    setEnabled: value => setAutoCopyVerificationCodes(userId, value),
  };
}
