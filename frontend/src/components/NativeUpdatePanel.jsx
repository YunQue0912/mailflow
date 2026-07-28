import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatNativeUpdateReleaseDate,
  NATIVE_UPDATE_KEYS,
  resolveNativeUpdateDisplayType,
} from '../utils/nativeUpdatePolicy.js';

function readAutoCheck() {
  return localStorage.getItem(NATIVE_UPDATE_KEYS.autoCheck) !== 'false';
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NativeUpdatePanel() {
  const { t, i18n } = useTranslation();
  const [bridge, setBridge] = useState(() => window.mailflowNative?.updates || null);
  const [status, setStatus] = useState({ type: 'idle' });
  const [autoCheck, setAutoCheck] = useState(readAutoCheck);
  const [skippedVersion, setSkippedVersion] = useState(() => localStorage.getItem(NATIVE_UPDATE_KEYS.skippedVersion) || '');
  const [deferredUntil, setDeferredUntil] = useState(() => Number(localStorage.getItem(NATIVE_UPDATE_KEYS.deferredUntil) || 0));
  const [deferredVersion, setDeferredVersion] = useState(() => localStorage.getItem(NATIVE_UPDATE_KEYS.deferredVersion) || '');

  useEffect(() => {
    if (bridge) return undefined;
    const timer = window.setInterval(() => {
      if (window.mailflowNative?.updates) {
        setBridge(window.mailflowNative.updates);
        window.clearInterval(timer);
      }
    }, 200);
    const timeout = window.setTimeout(() => window.clearInterval(timer), 3000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return undefined;
    let active = true;
    bridge.getState?.().then?.((next) => {
      if (active && next) setStatus(next);
    });
    const unsubscribe = bridge.onStatus?.((next) => {
      if (!next) return;
      if (next.version && skippedVersion && next.version !== skippedVersion) {
        localStorage.removeItem(NATIVE_UPDATE_KEYS.skippedVersion);
        setSkippedVersion('');
      }
      if (next.version && deferredVersion && next.version !== deferredVersion) {
        localStorage.removeItem(NATIVE_UPDATE_KEYS.deferredUntil);
        localStorage.removeItem(NATIVE_UPDATE_KEYS.deferredVersion);
        setDeferredUntil(0);
        setDeferredVersion('');
      }
      setStatus(next);
    });
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [bridge, deferredVersion, skippedVersion]);

  const displayedType = resolveNativeUpdateDisplayType(status, { skippedVersion, deferredVersion, deferredUntil });
  const size = formatBytes(status.size || status.progress?.total);
  const published = formatNativeUpdateReleaseDate(status.releaseDate, i18n.language);
  const progress = Math.max(0, Math.min(100, Number(status.progress?.percent || 0)));
  const actionStyle = {
    border: '1px solid var(--border)', borderRadius: 6, padding: '7px 11px', fontSize: 12,
    background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer',
  };
  const primaryStyle = { ...actionStyle, background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' };

  const statusText = displayedType === 'error'
    ? t(`admin.about.updates.errors.${status.messageKey || 'genericError'}`)
    : t(`admin.about.updates.status.${displayedType || 'idle'}`);

  const skip = () => {
    if (!status.version) return;
    localStorage.setItem(NATIVE_UPDATE_KEYS.skippedVersion, status.version);
    setSkippedVersion(status.version);
  };

  if (!bridge) return null;

  return (
    <section style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle)', paddingTop: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 12 }}>
        {t('admin.about.updates.title')}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(event) => {
            const checked = event.target.checked;
            setAutoCheck(checked);
            localStorage.setItem(NATIVE_UPDATE_KEYS.autoCheck, String(checked));
            if (checked) bridge.check?.(false)?.catch?.(() => {});
          }}
        />
        {t('admin.about.updates.autoCheck')}
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) minmax(0, 1fr)', gap: '7px 14px', fontSize: 12, marginBottom: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{t('admin.about.updates.currentVersion')}</span>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{status.currentVersion || '-'}</span>
        {status.version && <>
          <span style={{ color: 'var(--text-secondary)' }}>{t('admin.about.updates.latestVersion')}</span>
          <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{status.version}</span>
        </>}
        {published && <>
          <span style={{ color: 'var(--text-secondary)' }}>{t('admin.about.updates.published')}</span>
          <span style={{ color: 'var(--text-primary)' }}>{published}</span>
        </>}
        {size && <>
          <span style={{ color: 'var(--text-secondary)' }}>{t('admin.about.updates.size')}</span>
          <span style={{ color: 'var(--text-primary)' }}>{size}</span>
        </>}
      </div>

      <div aria-live="polite" style={{ fontSize: 12, color: displayedType === 'error' ? 'var(--red)' : 'var(--text-secondary)', marginBottom: 10 }}>
        {statusText}
      </div>

      {status.type === 'downloading' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ width: '100%', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 120ms linear' }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {progress.toFixed(0)}%
          </div>
        </div>
      )}

      {status.releaseNotes && (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>{t('admin.about.updates.notes')}</summary>
          <div style={{ marginTop: 8, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            {status.releaseNotes}
          </div>
        </details>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" style={actionStyle} disabled={status.type === 'checking' || status.type === 'downloading'} onClick={() => bridge.check?.(true)}>
          {t('admin.about.updates.check')}
        </button>
        {status.type === 'available' && displayedType === 'available' && <>
          <button type="button" style={primaryStyle} onClick={() => bridge.download?.()}>{t('admin.about.updates.download')}</button>
          <button type="button" style={actionStyle} onClick={() => {
            const until = Date.now() + (24 * 60 * 60 * 1000);
            localStorage.setItem(NATIVE_UPDATE_KEYS.deferredUntil, String(until));
            localStorage.setItem(NATIVE_UPDATE_KEYS.deferredVersion, status.version);
            setDeferredUntil(until);
            setDeferredVersion(status.version);
          }}>{t('admin.about.updates.later')}</button>
          <button type="button" style={actionStyle} onClick={skip}>{t('admin.about.updates.skip')}</button>
        </>}
        {status.type === 'downloading' && (
          <button type="button" style={actionStyle} onClick={() => bridge.cancel?.()}>{t('admin.about.updates.cancel')}</button>
        )}
        {status.type === 'downloaded' && (
          <button type="button" style={primaryStyle} onClick={() => bridge.installDownloaded?.()}>
            {window.mailflowNative?.platform === 'android' ? t('admin.about.updates.installAndroid') : t('admin.about.updates.install')}
          </button>
        )}
        {status.type === 'error' && status.retryable && (
          <button type="button" style={primaryStyle} onClick={() => bridge.check?.(true)}>{t('admin.about.updates.retry')}</button>
        )}
        {(status.releaseUrl || status.type === 'error') && (
          <button type="button" style={actionStyle} onClick={() => bridge.openDownload?.()}>{t('admin.about.updates.browser')}</button>
        )}
      </div>
    </section>
  );
}
