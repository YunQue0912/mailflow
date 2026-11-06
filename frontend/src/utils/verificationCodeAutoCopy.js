import {
  extractVerificationCodes, extractReliableVerificationCodes, VERIFICATION_CODE_MAX_INPUT,
} from './verificationCodes.js';
import { getAutoCopyVerificationCodes } from './verificationCodePreferences.js';

const MAX_AGE_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 30 * 1000;
const MAX_SEEN = 500;

function completeDetectionInput(input) {
  if (typeof input.subject === 'string' && input.subject.length > VERIFICATION_CODE_MAX_INPUT) return false;
  // Both MIME representations participate in detection: a truncated text or
  // HTML part cannot establish that the full message contains only one code.
  let hasBody = false;
  for (const part of [input.text, input.html]) {
    if (typeof part !== 'string' || !part.trim()) continue;
    hasBody = true;
    if (part.length > VERIFICATION_CODE_MAX_INPUT) return false;
  }
  return hasBody || typeof input.snippet !== 'string' || input.snippet.length <= VERIFICATION_CODE_MAX_INPUT;
}

function documentReady() {
  const doc = globalThis.document;
  return doc?.visibilityState === 'visible' && doc.hasFocus?.() === true;
}

async function writeClipboard(text) {
  // Automatic copies must never focus/select a scratch textarea. If the browser
  // declines this write, the message's user-activated Copy button is still usable.
  if (!globalThis.navigator?.clipboard?.writeText) return false;
  try { await globalThis.navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

/** A live-mail consumer; the only retained mail information is a bounded set of IDs. */
export function createVerificationCodeAutoCopy({
  getState,
  fetchBody,
  onCopied = () => {},
  getEnabled = getAutoCopyVerificationCodes,
  isDocumentReady = documentReady,
  copyText = writeClipboard,
  extractCodes = extractVerificationCodes,
  extractReliableCodes = extractCodes === extractVerificationCodes ? extractReliableVerificationCodes : extractCodes,
  now = Date.now,
} = {}) {
  let generation = 0;
  // Serialize writes: a slow earlier clipboard promise must settle before a newer
  // code is written. Every queued operation checks generation again when it runs.
  let writeQueue = Promise.resolve();
  let newestEventAt = -Infinity;
  const seen = new Map();

  function eligible(userId) {
    const state = getState?.();
    return !!userId && state?.user?.id === userId && !state.isLocked
      && getEnabled(userId) && isDocumentReady();
  }

  function fresh(message) {
    if (!message?.date) return false;
    const date = Date.parse(message.date);
    const age = now() - date;
    return Number.isFinite(date) && age >= -FUTURE_SKEW_MS && age <= MAX_AGE_MS;
  }

  function remember(key) {
    seen.set(key, now());
    for (const [id, at] of seen) {
      if (seen.size <= MAX_SEEN && now() - at <= MAX_AGE_MS) break;
      seen.delete(id);
    }
  }

  async function handleNewMessages(data) {
    const userId = getState?.()?.user?.id;
    if (!eligible(userId) || data?.type !== 'new_messages' || (data.folder && data.folder !== 'INBOX')) return false;
    const messages = data.alertMessages ?? data.messages;
    const count = data.alertCount ?? data.count;
    if (!(count > 0) || !Array.isArray(messages) || !messages.length) return false;

    // Newer live events invalidate pending body loads from an older event. We do
    // not replay mail when an earlier fetch/clipboard write fails.
    const candidates = messages.slice(-5).reverse()
      .filter(message => message?.id && (!message.folder || message.folder === 'INBOX')
        && (!message.accountId || message.accountId === data.accountId) && fresh(message))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const unseen = candidates.filter(message => !seen.has(`${userId}:${data.accountId}:${message.id}`));
    if (!unseen.length) return false;
    const eventDate = Date.parse(unseen[0].date);
    if (eventDate < newestEventAt) return false;
    newestEventAt = eventDate;
    const ticket = ++generation;
    for (const message of unseen) remember(`${userId}:${data.accountId}:${message.id}`);

    try {
      for (const message of unseen) {
        if (ticket !== generation || !eligible(userId)) return false;
        if (typeof message.subject === 'string' && message.subject.length > VERIFICATION_CODE_MAX_INPUT) return false;
        let input = message;
        if (fetchBody) {
          const body = await fetchBody(message.id);
          if (ticket !== generation || !eligible(userId) || !fresh(message)) return false;
          if (!body || typeof body !== 'object') return false;
          // A preview can contain a quoted old code or omit a second code later
          // in the message. Confirm against the full body, without letting a
          // filtered/empty body fall back to that potentially misleading snippet.
          input = { subject: message.subject, text: body.text, html: body.html };
        }
        if (!completeDetectionInput(input)) return false;
        const codes = extractCodes(input);
        // Ambiguity is left for the user; never pick one of several plausible codes.
        if (codes.length > 1) return false;
        if (codes.length !== 1) continue;
        // A plausible manual suggestion is not enough to replace the clipboard.
        // Stop this batch rather than falling back to an older, more confident code.
        const reliable = extractReliableCodes(input);
        if (reliable.length !== 1 || reliable[0] !== codes[0]) return false;
        const code = codes[0];
        const write = writeQueue.catch(() => {}).then(async () => {
          if (ticket !== generation || !eligible(userId) || !fresh(message)) return false;
          const copied = await copyText(code);
          if (copied === true && ticket === generation && eligible(userId)) onCopied();
          return copied === true;
        });
        writeQueue = write;
        return await write;
      }
    } catch {
      // A failed fetch/write is not a reason to retry and replace a later clipboard.
      // Codes and provider error text must never enter logs or diagnostic events.
    }
    return false;
  }

  return {
    handleNewMessages,
    // Call on lock, authentication changes, preference changes and unmount. This
    // invalidates old work even for A -> B -> A and off -> on transitions.
    cancel() { generation++; newestEventAt = -Infinity; },
  };
}
