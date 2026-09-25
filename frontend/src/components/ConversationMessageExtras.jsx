import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { api } from '../utils/api.js';
import { BUILTIN_SUMMARIZE, summarizePromptForLocale } from '../aiActions.js';
import { getResults, saveResult, removeResult } from '../aiResults.js';
import { aiRuns } from '../utils/aiRunRegistry.js';
import MessageHeaderModal from './MessageHeaderModal.jsx';
import SpamBadge from './SpamBadge.jsx';
import SpamExplainModal from './SpamExplainModal.jsx';

export default function ConversationMessageExtras({ message, body, expanded }) {
  const { t, i18n } = useTranslation();
  const { updateMessage, addNotification, aiActions } = useStore();
  const [showHeaderModal, setShowHeaderModal] = useState(false);
  const [showSpamExplain, setShowSpamExplain] = useState(false);
  const [starBusy, setStarBusy] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [unsubscribeStatus, setUnsubscribeStatus] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const activeActionRef = useRef(null);

  useEffect(() => () => { activeActionRef.current = null; }, []);
  useEffect(() => {
    if (!expanded || activeActionRef.current) return;
    const saved = Object.entries(getResults(message.id)).sort((a, b) => b[1].at - a[1].at)[0];
    if (saved) setAiResult({ ...saved[1], actionKey: saved[0], status: 'done' });
  }, [expanded, message.id]);
  const toggleStar = async event => {
    event.stopPropagation();
    if (starBusy) return;
    const starred = !message.is_starred;
    setStarBusy(true);
    updateMessage(message.id, { is_starred: starred });
    try {
      await api.markStarred(message.id, starred);
    } catch {
      updateMessage(message.id, { is_starred: !starred });
      addNotification({ type: 'error', title: t('common.error', { message: t('message.star') }) });
    } finally {
      setStarBusy(false);
    }
  };

  const toggleMoreMenu = () => {
    const next = !showMoreMenu;
    setShowMoreMenu(next);
    if (next && !aiStatus) api.ai.status().then(setAiStatus).catch(() => setAiStatus({ enabled: false }));
  };

  const unsubscribe = async () => {
    if (unsubscribeStatus === 'loading') return;
    setShowMoreMenu(false);
    setUnsubscribeStatus('loading');
    try {
      const result = await api.unsubscribeMessage(message.id);
      const succeeded = ['one-click', 'url', 'mailto'].includes(result.type);
      if (!succeeded) throw new Error(t('message.unsubscribe.error'));
      if (result.type === 'url' && result.url) window.open(result.url, '_blank', 'noopener,noreferrer');
      if (result.type === 'mailto' && result.mailto) window.open(result.mailto, '_blank', 'noopener,noreferrer');
      setUnsubscribeStatus('done');
      addNotification({ title: t('message.unsubscribe.done') });
    } catch {
      setUnsubscribeStatus('error');
      addNotification({ type: 'error', title: t('message.unsubscribe.error') });
    }
  };

  const runAiAction = async action => {
    const textContent = body?.text
      || body?.html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      || '';
    if (!action?.id || !textContent) return;
    setShowMoreMenu(false);
    const controller = aiRuns.start(message.id, action.id, new AbortController());
    activeActionRef.current = controller;
    const label = action.id === BUILTIN_SUMMARIZE.id ? t('message.summary') : action.label;
    const applyResult = result => {
      if (activeActionRef.current === controller && !controller.signal.aborted) {
        setAiResult({ ...result, actionKey: action.id });
      }
    };
    applyResult({ status: 'loading', label, text: '' });
    try {
      const prompt = action.builtin ? summarizePromptForLocale(i18n.language) : action.prompt;
      const fullText = await api.ai.chat([{
        role: 'user', content: `${prompt}\n\n${textContent.slice(0, 6000)}`,
      }], {
        signal: controller.signal,
        onDelta: text => applyResult({ status: 'loading', label, text }),
      });
      if (!controller.signal.aborted) {
        if (fullText) saveResult(message.id, action.id, fullText, label);
        applyResult({ status: 'done', label, text: fullText });
      }
    } catch (requestError) {
      if (requestError.name !== 'AbortError') applyResult({ status: 'error', label, text: requestError.message });
    } finally {
      if (!controller.signal.aborted) aiRuns.finish(message.id, action.id);
      if (activeActionRef.current === controller) activeActionRef.current = null;
    }
  };

  const dismissAiResult = () => {
    if (aiResult?.actionKey) {
      aiRuns.abort(message.id, aiResult.actionKey);
      removeResult(message.id, aiResult.actionKey);
    }
    setAiResult(null);
  };

  return (
    <>
      <SpamBadge message={message} onClick={() => setShowSpamExplain(true)} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button type="button" onClick={toggleStar} disabled={starBusy} title={message.is_starred ? t('contextMenu.unstar') : t('message.star')} aria-label={message.is_starred ? t('contextMenu.unstar') : t('message.star')} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: message.is_starred ? 'var(--amber)' : 'var(--text-secondary)', background: 'transparent', cursor: starBusy ? 'wait' : 'pointer' }}>{message.is_starred ? <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}</button>
                  <div style={{ position: 'relative' }}>
                    <button type="button" onClick={toggleMoreMenu} title={t('message.more')} aria-label={t('message.more')} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', fontSize: 12 }}>...</button>
                    {showMoreMenu && <>
                      <div aria-hidden onClick={() => setShowMoreMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: 190, zIndex: 20, padding: 4, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-popover)' }}>
                        <button type="button" onClick={() => { setShowMoreMenu(false); setShowHeaderModal(true); }} style={{ width: '100%', border: 'none', background: 'transparent', color: 'var(--text-primary)', padding: '8px 10px', textAlign: 'left', cursor: 'pointer' }}>{t('contextMenu.viewHeaders')}</button>
                        {message.list_unsubscribe && !message.unsubscribed_at && unsubscribeStatus !== 'done' && <button type="button" disabled={unsubscribeStatus === 'loading'} onClick={unsubscribe} style={{ width: '100%', border: 'none', background: 'transparent', color: unsubscribeStatus === 'error' ? 'var(--red, #e53e3e)' : 'var(--text-primary)', padding: '8px 10px', textAlign: 'left', cursor: unsubscribeStatus === 'loading' ? 'wait' : 'pointer' }}>{unsubscribeStatus === 'loading' ? t('common.loading') : t('message.unsubscribe.button')}</button>}
                        {aiStatus?.enabled && aiStatus?.features?.summarize && body && <>
                          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '3px 0' }} />
                          <button type="button" onClick={() => runAiAction(BUILTIN_SUMMARIZE)} style={{ width: '100%', border: 'none', background: 'transparent', color: 'var(--text-primary)', padding: '8px 10px', textAlign: 'left', cursor: 'pointer' }}>{t('message.summarize')}</button>
                          {(aiActions || []).map(action => <button type="button" key={action.id} onClick={() => runAiAction(action)} style={{ width: '100%', border: 'none', background: 'transparent', color: 'var(--text-primary)', padding: '8px 10px', textAlign: 'left', cursor: 'pointer' }}>{action.label}</button>)}
                        </>}
                      </div>
                    </>}
                  </div>
                </div>
                {aiResult && <div style={{ marginBottom: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: aiResult.text ? 7 : 0 }}><strong style={{ flex: 1, color: 'var(--text-primary)' }}>{aiResult.label}</strong><span>{aiResult.status === 'loading' ? t('common.loading') : aiResult.status === 'error' ? t('common.error', { message: aiResult.text }) : ''}</span><button type="button" onClick={dismissAiResult} title={t('common.dismiss')} aria-label={t('common.dismiss')} style={{ border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer' }}>x</button></div>
                  {aiResult.status !== 'error' && aiResult.text && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{aiResult.text}</div>}
                </div>}
      {showHeaderModal && <MessageHeaderModal messageId={message.id} subject={message.subject} onClose={() => setShowHeaderModal(false)} />}
      {showSpamExplain && <SpamExplainModal messageId={message.id} onClose={() => setShowSpamExplain(false)} />}
    </>
  );
}
