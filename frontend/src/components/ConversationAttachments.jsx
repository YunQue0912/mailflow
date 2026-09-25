import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { downloadAttachmentFile } from '../utils/attachmentDownload.js';
import { classifyAttachmentRisk } from '../utils/attachmentRisk.js';
const DOWNLOAD_ALL = Symbol('downloadAll');
function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }) {
  const normalized = (type || '').toLowerCase();
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75 };
  if (normalized.startsWith('image/')) return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
  if (normalized === 'application/pdf' || normalized.includes('word') || normalized.includes('document')) return <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
  if (normalized.includes('sheet') || normalized.includes('excel') || normalized.includes('csv')) return <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="10" y1="13" x2="10" y2="17"/><line x1="8" y1="15" x2="12" y2="15"/></svg>;
  if (normalized.includes('zip') || normalized.includes('compressed') || normalized.includes('archive')) return <svg {...props}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="11" x2="16" y2="11"/></svg>;
  if (normalized.startsWith('video/')) return <svg {...props}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
  if (normalized.startsWith('audio/')) return <svg {...props}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
  return <svg {...props}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>;
}

export default function ConversationAttachments({ message, attachments = [] }) {
  const { t } = useTranslation();
  const addNotification = useStore(s => s.addNotification);
  const messageId = message.id;
  const [downloadingPart, setDownloadingPart] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [riskArmed, setRiskArmed] = useState(null);
  useEffect(() => { setRiskArmed(null); }, [messageId]);
  const downloadAttachment = async attachment => {
    setDownloadingPart(attachment.part);
    try {
      await downloadAttachmentFile({
        path: `/api/mail/messages/${messageId}/attachments/${encodeURIComponent(attachment.part)}`,
        filename: attachment.filename,
        mimeType: attachment.type,
      });
    } catch (error) {
      console.error('Download error:', error);
      addNotification({
        type: 'error',
        title: t('message.downloadFailed.title'),
        body: t('message.downloadFailed.body'),
      });
    } finally {
      setDownloadingPart(null);
    }
  };

  const downloadAllAttachments = async () => {
    if (attachments.some(att => ['block', 'warn'].includes(classifyAttachmentRisk(att.filename, att.type).level)) && riskArmed !== DOWNLOAD_ALL) {
      setRiskArmed(DOWNLOAD_ALL);
      return;
    }
    setRiskArmed(null);
    setDownloadingAll(true);
    try {
      await downloadAttachmentFile({
        path: `/api/mail/messages/${messageId}/attachments.zip`,
        filename: `${message?.subject || 'attachments'}-attachments.zip`,
        mimeType: 'application/zip',
      });
    } catch (error) {
      console.error('Download all attachments error:', error);
      addNotification({
        type: 'error',
        title: t('message.downloadFailed.title'),
        body: t('message.downloadFailed.body'),
      });
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <>
      {attachments.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>{t('message.attachment', { count: attachments.length })}</div>
            {attachments.length > 1 && <button type="button" onClick={downloadAllAttachments} disabled={downloadingAll} style={{ padding: 0, border: 'none', background: 'transparent', fontSize: 12, color: 'var(--accent)', cursor: downloadingAll ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><span aria-hidden="true">↓</span>{downloadingAll ? t('message.downloading') : riskArmed === DOWNLOAD_ALL ? t('message.attachmentRisk.armed', { label: t('message.downloadAll') }) : t('message.downloadAll')}</button>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {attachments.map((attachment, index) => {
              const risk = classifyAttachmentRisk(attachment.filename, attachment.type);
              const risky = risk.level === 'block' || risk.level === 'warn';
              const riskColor = risk.level === 'block' ? 'var(--red)' : risk.level === 'warn' ? 'var(--amber)' : 'var(--text-tertiary)';
              const armed = riskArmed === attachment.part;
              return (
              <button key={`${attachment.part}-${index}`} onClick={() => {
                if (risky && !armed) { setRiskArmed(attachment.part); return; }
                setRiskArmed(null);
                downloadAttachment(attachment);
              }} disabled={downloadingPart === attachment.part} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: `1px solid ${risky ? riskColor : 'var(--border)'}`, cursor: downloadingPart === attachment.part ? 'wait' : 'pointer', color: 'var(--text-primary)', maxWidth: 240 }}>
                <span style={{ display: 'flex', flexShrink: 0, color: 'var(--text-secondary)' }}><FileIcon type={attachment.type}/></span>
                <span style={{ minWidth: 0, textAlign: 'left' }}><span style={{ display: 'block', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.filename}</span><span style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{downloadingPart === attachment.part ? t('message.downloading') : formatBytes(attachment.size)}</span>
                  {risk.level !== 'ok' && <span style={{ display: 'block', fontSize: 11, color: riskColor, fontWeight: risk.level === 'block' ? 600 : 400, whiteSpace: 'normal' }}>
                    {risk.doubleExt ? t('message.attachmentRisk.doubleExt', { ext: risk.doubleExt }) : t(`message.attachmentRisk.${risk.level}`, { ext: risk.ext })}
                    {armed && ` — ${t('message.attachmentRisk.confirm')}`}
                  </span>}
                </span>
                <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>↓</span>
              </button>
              );
            })}
          </div>
        </div>
      )}

    </>
  );
}
