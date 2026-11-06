// Download a message's raw RFC 822 source as an .eml file (#381). A same-origin anchor click carries
// the session cookie; the route sets the Content-Disposition filename. Shared by the message pane
// (desktop toolbar and mobile More menu) and the message-list context menu.
import { downloadMessageEml } from './attachmentDownload.js';

export function emlDownloadUrl(messageId) {
  return `/api/mail/messages/${encodeURIComponent(messageId)}/raw.eml`;
}

// Returns false when there is nothing to download (no id) or no document to click in.
export function downloadEml(messageId, doc = globalThis.document, nativeBridge = globalThis.window?.mailflowNative) {
  if (!messageId || !doc?.body) return false;
  if (nativeBridge?.platform === 'android' && nativeBridge.attachments?.download) {
    return downloadMessageEml(messageId, { nativeBridge, documentImpl: doc });
  }
  const a = doc.createElement('a');
  a.href = emlDownloadUrl(messageId);
  a.download = '';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
