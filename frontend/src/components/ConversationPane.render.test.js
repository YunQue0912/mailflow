import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) {
      return { format: 'module', shortCircuit: true, source: `
        const t = key => key;
        export const useTranslation = () => ({ t, i18n: { language: 'en' } });
        export const initReactI18next = { type: '3rdParty', init() {} };
        export const Trans = ({ children }) => children ?? null;
        export const I18nextProvider = ({ children }) => children ?? null;
      ` };
    }
    if (url.endsWith('.json')) {
      return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(new URL(url), 'utf8')}` };
    }
    if (url.startsWith('file:') && /\.jsx?$/.test(url)) {
      let code = readFileSync(new URL(url), 'utf8');
      if (url.endsWith('.jsx') || code.includes('import.meta.env')) {
        if (url.endsWith('.jsx')) code = transform(code, { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url }).code;
        return { format: 'module', shortCircuit: true, source: code.replaceAll('import.meta.env', 'globalThis.__VITE_ENV__') };
      }
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example.invalid', pretendToBeVisual: true });
const frames = new Map();
const observers = [];
let frameId = 0;
class ResizeObserverStub {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(target) { this.target = target; }
  unobserve() { this.target = null; }
  disconnect() { this.target = null; }
}
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: id => frames.delete(id),
  ResizeObserver: ResizeObserverStub, IS_REACT_ACT_ENVIRONMENT: true,
  __VITE_ENV__: { MODE: 'test', DEV: false, PROD: true },
});
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.ResizeObserver = ResizeObserverStub;
globalThis.matchMedia = window.matchMedia;
globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '' });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useStore } = await import('../store/index.js');
const { api } = await import('../utils/api.js');
const { aiRuns } = await import('../utils/aiRunRegistry.js');
const { getResults } = await import('../aiResults.js');
const { BUILTIN_SUMMARIZE } = await import('../aiActions.js');
const ConversationPane = (await import('./ConversationPane.jsx')).default;
const ConversationMessageCard = (await import('./ConversationMessageCard.jsx')).default;
const MessageBodyView = (await import('./MessageBodyView.jsx')).default;
const MessagePane = (await import('./MessagePane.jsx')).default;

const container = document.getElementById('root');
const ACCOUNT = { id: 'acct', email_address: 'me@example.invalid', enabled: true, include_in_unified_inbox: true };
const message = (id, extra = {}) => ({
  id, message_id: `<${id}@example.invalid>`, thread_id: 'thread', account_id: ACCOUNT.id,
  folder: 'INBOX', uid: 1, subject: 'Thread subject', from_email: 'sender@example.invalid',
  date: '2026-09-17T00:00:00Z', is_read: false, to_addresses: [], cc_addresses: [], ...extra,
});
const initial = [message('first'), message('second')];
const fresh = [...initial, message('new-reply', { date: '2026-09-17T01:00:00Z' })];
let root;
beforeEach(() => {
  localStorage.removeItem('mailflow_ai_results');
  useStore.setState({
    user: { id: 'user' }, isLocked: false, accounts: [ACCOUNT], accountsReady: true,
    messages: initial, selectedMessageId: 'first', selectedMessageSource: null,
    selectedAccountId: 'acct', selectedFolder: 'INBOX', markReadBehavior: 'manual',
    threadMessages: { thread: initial }, notifications: [], searchQuery: '',
    pendingCounts: {}, serverUnreadCounts: { total: 0, byAccount: {}, snapshots: {} },
  });
  api.getThread = async () => ({ messages: initial });
  api.getMessageBody = async () => ({ text: 'Mail body', attachments: [] });
  api.getUnreadCounts = async () => ({ total: 0, byAccount: {}, snapshots: {} });
  api.getCategoryCounts = async () => ({ counts: {} });
  api.getFolders = async () => [{ path: 'Personal/Archive', name: 'Archive', delimiter: '/' }];
  api.ai.status = async () => ({ enabled: true, features: { summarize: true } });
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => {
    root.unmount();
    useStore.getState().setLocked(true);
  });
  frames.clear();
  observers.length = 0;
  delete window.mailflowNative;
});
const render = async (Component, props = {}) => React.act(async () => root.render(React.createElement(Component, props)));
const click = async element => {
  assert.ok(element, 'expected the action to be rendered');
  await React.act(async () => element.click());
};
const labelled = label => container.querySelector(`button[title="${label}"]`);
const flushFrames = async () => React.act(async () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(0));
});

for (const [label, method, resultKey] of [
  ['message.archive', 'bulkArchive', 'archived'],
  ['message.delete', 'bulkDelete', 'deleted'],
  ['contextMenu.markRead', 'bulkRead', null],
]) {
  test(`conversation ${method} includes replies received after the pane opened`, async () => {
    await render(ConversationPane, { message: initial[0], threadId: 'thread' });
    let received;
    api.getThread = async () => ({ messages: fresh });
    api[method] = async ids => { received = ids; return resultKey ? { [resultKey]: ids } : {}; };
    await click(labelled(label));
    assert.deepEqual(received, fresh.map(item => item.id));
  });
}

test('conversation move resolves again after the folder picker has opened', async () => {
  await render(ConversationPane, { message: initial[0], threadId: 'thread' });
  await click(labelled('contextMenu.moveToFolder'));
  let received;
  api.getThread = async () => ({ messages: fresh });
  api.bulkMove = async (ids, folder) => { received = { ids, folder }; return { moved: ids }; };
  await click(labelled('Personal/Archive'));
  assert.deepEqual(received, { ids: fresh.map(item => item.id), folder: 'Personal/Archive' });
});

test('a failed thread refresh cannot delete the stale cached snapshot', async () => {
  await render(ConversationPane, { message: initial[0], threadId: 'thread' });
  let deleted = false;
  api.getThread = async () => { throw new Error('offline'); };
  api.bulkDelete = async () => { deleted = true; return {}; };
  await click(labelled('message.delete'));
  assert.equal(deleted, false);
  assert.equal(useStore.getState().notifications.at(-1).type, 'error');
});

test('conversation spam action includes fresh replies but excludes sent messages', async () => {
  await render(ConversationPane, { message: initial[0], threadId: 'thread' });
  api.getThread = async () => ({ messages: [...fresh, message('sent', { folder: 'Sent', from_email: ACCOUNT.email_address })] });
  const received = [];
  api.markSpam = async id => { received.push(id); return {}; };
  await click(labelled('contextMenu.markAsSpam'));
  assert.deepEqual(received, fresh.map(item => item.id));
});

test('conversation cards show automatic spam classification and respect a user override', async () => {
  const item = message('spam-card', { spam_verdict: 'spam', spam_score_ml: 0.98 });
  await render(ConversationMessageCard, { message: item, expanded: false });
  assert.ok(labelled('spam.badgeTitle'));
  await render(ConversationMessageCard, { message: { ...item, spam_user_override: 'ham' }, expanded: false });
  assert.equal(labelled('spam.badgeTitle'), null);
});

for (const Component of [MessageBodyView, MessagePane]) {
  test(`${Component === MessagePane ? 'single' : 'conversation'} reading warns before handing risky attachments to Android`, async () => {
    const item = message(Component === MessagePane ? 'single-download' : 'conversation-download');
    const attachment = { filename: 'invoice.pdf.exe', part: '2', type: 'application/octet-stream', size: 42 };
    api.getMessageBody = async () => ({ text: 'Mail body', attachments: [attachment] });
    const downloads = [];
    window.mailflowNative = { platform: 'android', attachments: { download: async options => { downloads.push(options); return { started: true }; } } };
    useStore.setState({ messages: [item], selectedMessageId: item.id });
    await render(Component, { message: item });
    const button = [...container.querySelectorAll('button')].find(el => el.textContent.includes(attachment.filename));
    await click(button);
    assert.equal(downloads.length, 0);
    assert.ok(button.textContent.includes('message.attachmentRisk.confirm'));
    await click(button);
    assert.deepEqual(downloads, [{
      url: `https://mail.example.invalid/api/mail/messages/${item.id}/attachments/2`,
      filename: attachment.filename, mimeType: attachment.type,
    }]);
  });
}

test('conversation HTML initializes before all images load and can shrink after reflow', async () => {
  api.getMessageBody = async () => ({ html: '<p>Hello</p>', attachments: [] });
  await render(MessageBodyView, { message: message('frame') });
  const iframe = container.querySelector('iframe');
  const doc = iframe.contentDocument;
  doc.body.innerHTML = '<div id="mf-scale-wrapper"><img loading="lazy" src="https://images.example.invalid/pixel"></div>';
  Object.defineProperty(doc, 'readyState', { configurable: true, value: 'interactive' });
  let height = 140;
  Object.defineProperty(doc.getElementById('mf-scale-wrapper'), 'offsetHeight', { get: () => height });
  Object.defineProperty(doc.body, 'scrollHeight', { get: () => height });
  Object.defineProperty(doc.documentElement, 'scrollHeight', { get: () => 900 });
  await flushFrames();
  assert.equal(iframe.style.height, '140px');
  assert.equal(doc.querySelector('img').getAttribute('loading'), 'eager');
  height = 70;
  observers.find(observer => observer.target === doc.body).callback();
  await flushFrames();
  assert.equal(iframe.style.height, '70px');
});

async function startCardAi(id) {
  const item = message(id);
  let finish;
  let signal;
  api.ai.chat = async (_messages, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  await render(ConversationMessageCard, { message: item, expanded: true, onToggle() {}, onReply() {}, onForward() {} });
  await click(labelled('message.more'));
  await click([...container.querySelectorAll('button')].find(el => el.textContent === 'message.summarize'));
  assert.equal(aiRuns.size, 1);
  return { item, get signal() { return signal; }, finish: text => finish(text) };
}

test('conversation AI finishes after navigation and restores the saved result on return', async () => {
  const run = await startCardAi('ai-navigation');
  await render(() => null);
  assert.equal(run.signal.aborted, false);
  await React.act(async () => run.finish('Saved summary'));
  assert.equal(getResults(run.item.id)[BUILTIN_SUMMARIZE.id].text, 'Saved summary');
  await render(ConversationMessageCard, { message: run.item, expanded: true, onToggle() {}, onReply() {}, onForward() {} });
  assert.ok(container.textContent.includes('Saved summary'));
});

test('locking cancels conversation AI and prevents late results being saved', async () => {
  const run = await startCardAi('ai-lock');
  await React.act(async () => useStore.getState().setLocked(true));
  assert.equal(run.signal.aborted, true);
  await React.act(async () => run.finish('Must not be saved'));
  assert.deepEqual(getResults(run.item.id), {});
});
