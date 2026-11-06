import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { extractVerificationCodes } from '../utils/verificationCodes.js';
import { copyToClipboard, selectElementText } from '../utils/clipboard.js';

// The same local detection and copy controls in the reading pane, message window,
// and expanded conversation card. Nothing is fetched, persisted, or sent to AI.
export default function VerificationCodeNotice({ message, body, compact = false }) {
  const { t } = useTranslation();
  const userId = useStore(state => state.user?.id);
  const isLocked = useStore(state => state.isLocked);
  const codes = useMemo(() => extractVerificationCodes({
    subject: message?.subject,
    snippet: message?.snippet,
    text: body?.text,
    html: body?.html,
  }), [message?.subject, message?.snippet, body?.text, body?.html]);
  const codesKey = codes.join('\u0000');
  const [feedback, setFeedback] = useState(null);
  const codeElements = useRef(new Map());
  const requestRef = useRef(null);
  const scopeRef = useRef(null);
  const mountedRef = useRef(false);
  const scope = `${userId || ''}\u0000${message?.id || ''}\u0000${codesKey}`;
  scopeRef.current = scope;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current = null; };
  }, []);

  useEffect(() => {
    requestRef.current = null;
    setFeedback(null);
  }, [userId, message?.id, isLocked, codesKey]);

  // Observe every session transition, including a lock/unlock or sign-out/sign-in
  // batched into one React render. A pending fallback belongs to the old session.
  useEffect(() => useStore.subscribe?.((next, previous) => {
    if (next.isLocked !== previous.isLocked || next.user?.id !== previous.user?.id) {
      requestRef.current = null;
      setFeedback(null);
    }
  }), []);

  const copy = async (code) => {
    const current = useStore.getState();
    if (!userId || current.user?.id !== userId || current.isLocked || !codes.includes(code)) return;
    if (requestRef.current?.scope === scope) return;
    const request = { scope };
    requestRef.current = request;
    setFeedback({ code, kind: 'pending', scope });
    const shouldCopy = () => {
      const latest = useStore.getState();
      return mountedRef.current && requestRef.current === request && scopeRef.current === scope
        && latest.user?.id === userId && !latest.isLocked;
    };
    const result = await copyToClipboard(code, { shouldCopy });
    const latest = useStore.getState();
    if (!mountedRef.current || requestRef.current !== request || scopeRef.current !== scope
        || latest.user?.id !== userId || latest.isLocked) return;
    requestRef.current = null;
    if (result.ok) {
      setFeedback({ code, kind: 'copied', scope });
    } else {
      selectElementText(codeElements.current.get(code));
      setFeedback({ code, kind: 'failed', scope });
    }
  };

  if (!userId || isLocked || !message?.id || !codes.length) return null;
  const activeFeedback = feedback?.scope === scope ? feedback : null;

  return (
    <section aria-label={t('verificationCodes.title')} onClick={event => event.stopPropagation()} style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 10px',
      padding: compact ? 0 : '4px 0', marginTop: compact ? 6 : 0,
      marginBottom: compact ? 0 : 12,
      color: 'var(--text-primary)', minWidth: 0,
    }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}>
        {t('verificationCodes.title')}
      </span>
      {codes.map(code => (
        <span key={code} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%',
          paddingLeft: 10, borderRadius: 6,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
        }}>
          <code ref={element => {
            if (element) codeElements.current.set(code, element);
            else codeElements.current.delete(code);
          }} tabIndex={0} style={{
            fontSize: compact ? 14 : 15, fontWeight: 600, letterSpacing: '0.06em',
            overflowWrap: 'anywhere', userSelect: 'text',
          }}>{code}</code>
          <button type="button" onClick={() => copy(code)}
            aria-label={t('verificationCodes.copyLabel', { code })}
            disabled={activeFeedback?.kind === 'pending'}
            style={{
              flexShrink: 0, minHeight: 44, padding: '6px 10px', borderRadius: 6,
              border: 'none', borderLeft: '1px solid var(--border-subtle)', background: 'transparent',
              color: 'var(--accent)', cursor: activeFeedback?.kind === 'pending' ? 'wait' : 'pointer',
              fontSize: 12, fontWeight: 500,
            }}>
            {t(activeFeedback?.code === code && activeFeedback.kind === 'copied'
              ? 'verificationCodes.copied' : 'verificationCodes.copy')}
          </button>
        </span>
      ))}
      {activeFeedback?.kind === 'copied' && (
        <span role="status" aria-live="polite" style={{
          position: 'absolute', width: 1, height: 1, overflow: 'hidden',
          clipPath: 'inset(50%)', whiteSpace: 'nowrap',
        }}>
          {t('verificationCodes.copied')}
        </span>
      )}
      {activeFeedback?.kind === 'failed' && (
        <span role="alert" style={{ flexBasis: '100%', color: 'var(--red)', fontSize: 12 }}>
          {t('verificationCodes.copyFailed')}
        </span>
      )}
    </section>
  );
}
