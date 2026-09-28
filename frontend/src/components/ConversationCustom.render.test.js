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
const ConversationMessageCard = (await import('./ConversationMessageCard.jsx')).default;
const ConversationPane = (await import('./ConversationPane.jsx')).default;
const MessagePane = (await import('./MessagePane.jsx')).default;

const container = document.getElementById('root');
const ACCOUNT = { id: 'acct', email_address: 'me@example.invalid', enabled: true, include_in_unified_inbox: true };
const message = (id, extra = {}) => ({
  id, message_id: `<${id}@example.invalid>`, thread_id: 'thread', account_id: ACCOUNT.id,
  folder: 'INBOX', uid: 1, subject: 'Thread subject', from_email: 'sender@example.invalid',
  date: '2026-09-17T00:00:00Z', is_read: false, to_addresses: [], cc_addresses: [], ...extra,
});
const initial = [message('first'), message('second')];
let root;
beforeEach(() => {
  window.innerWidth = 1024;
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

for (const Component of [ConversationMessageCard, MessagePane]) {
  for (const width of [480, 1024]) {
  test(`${Component === MessagePane ? 'single' : 'conversation'} reading at width ${width} downloads original EML through Android`, async () => {
    window.innerWidth = width;
    const item = message('11111111-1111-4111-8111-111111111111');
    const downloads = [];
    window.mailflowNative = { platform: 'android', attachments: { download: async options => { downloads.push(options); return { started: true }; } } };
    useStore.setState({ messages: [item], selectedMessageId: item.id });
    await render(Component, { message: item, expanded: true, onToggle() {} });
    if (Component === MessagePane && width >= 768) {
      await click(labelled('message.downloadEml'));
    } else {
      await click(labelled('message.more'));
      await click([...container.querySelectorAll('button, div')].find(el => el.textContent === 'message.downloadEml'));
    }
    assert.deepEqual(downloads, [{
      url: `https://mail.example.invalid/api/mail/messages/${item.id}/raw.eml`,
      filename: `message-${item.id}.eml`, mimeType: 'message/rfc822',
    }]);
  });
  }

  test(`${Component === MessagePane ? 'single' : 'conversation'} reading warns before handing risky attachments to Android`, async () => {
    const item = message(Component === MessagePane ? 'single-download' : 'conversation-download');
    const attachment = { filename: 'invoice.pdf.exe', part: '2', type: 'application/octet-stream', size: 42 };
    api.getMessageBody = async () => ({ text: 'Mail body', attachments: [attachment] });
    const downloads = [];
    window.mailflowNative = { platform: 'android', attachments: { download: async options => { downloads.push(options); return { started: true }; } } };
    useStore.setState({ messages: [item], selectedMessageId: item.id });
    await render(Component, { message: item, expanded: true, onToggle() {} });
    const button = [...container.querySelectorAll('button')].find(el => el.textContent.includes(attachment.filename));
    await click(button);
    assert.equal(downloads.length, 0);
    assert.match(button.textContent, /message\.attachmentRisk\.(confirm|armed)/);
    await click(button);
    assert.deepEqual(downloads, [{
      url: `https://mail.example.invalid/api/mail/messages/${item.id}/attachments/2`,
      filename: attachment.filename, mimeType: attachment.type,
    }]);
  });
}

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

test('thread mark-read includes a newly arrived delivery from another account', async (t) => {
  const calls = [];
  t.mock.method(api, 'bulkRead', async (ids, read) => { calls.push({ ids, read }); });
  await render(ConversationPane, { threadId: 'thread', folder: 'INBOX', unified: true });
  const secondAccount = message('second-account-copy', { account_id: 'other-account', message_id: initial[0].message_id });
  api.getThread = async () => ({ messages: [...initial, secondAccount] });
  await click(labelled('contextMenu.markRead'));
  assert.deepEqual(calls, [{ ids: ['first', 'second', 'second-account-copy'], read: true }]);
  assert.ok(useStore.getState().threadMessages.thread.every(item => item.is_read));
});

test('thread mark-read stops if refreshing the membership fails', async (t) => {
  const bulkRead = t.mock.method(api, 'bulkRead', async () => {});
  await render(ConversationPane, { threadId: 'thread', folder: 'INBOX' });
  api.getThread = async () => { throw new Error('offline'); };
  await click(labelled('contextMenu.markRead'));
  assert.equal(bulkRead.mock.callCount(), 0);
  assert.ok(useStore.getState().notifications.some(item => item.type === 'error'));
});

test('GTD opening retains its own mark-read policy', async (t) => {
  const bulkRead = t.mock.method(api, 'bulkRead', async () => {});
  useStore.setState({ selectedMessageSource: 'gtd', markReadBehavior: 'immediate' });
  await render(ConversationMessageCard, { message: message('gtd-open'), expanded: true, onToggle() {} });
  assert.equal(bulkRead.mock.callCount(), 0);
});

test('explicit thread read cancels a delayed automatic card read', async (t) => {
  const bulkRead = t.mock.method(api, 'bulkRead', async () => {});
  useStore.setState({ markReadBehavior: 'delay', markReadDelay: 1 });
  await render(ConversationPane, { threadId: 'thread', folder: 'INBOX' });
  await click(labelled('contextMenu.markRead'));
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
  assert.equal(bulkRead.mock.callCount(), 1, 'the delayed open must not decrement unread counts again');
});

for (const Component of [ConversationMessageCard, MessagePane]) {
  test(Component.name + ' confirms ZIP downloads before invoking Android', async () => {
    const item = message('zip-' + Component.name);
    api.getMessageBody = async () => ({ text: 'body', attachments: [
      { filename: 'invoice.exe.', part: 'all', type: 'application/octet-stream' },
      { filename: 'notes.txt', part: '2', type: 'text/plain' },
    ] });
    const downloads = [];
    window.mailflowNative = { platform: 'android', attachments: { download: async options => { downloads.push(options); return { started: true }; } } };
    useStore.setState({ messages: [item], selectedMessageId: item.id });
    await render(Component, { message: item, expanded: true, onToggle() {} });
    const button = [...container.querySelectorAll('button')].find(el => el.textContent.includes('message.downloadAll'));
    await click(button);
    assert.equal(downloads.length, 0);
    assert.equal(button.hasAttribute('href'), false);
    await click(button);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].url, 'https://mail.example.invalid/api/mail/messages/' + item.id + '/attachments.zip');
    assert.equal(downloads[0].mimeType, 'application/zip');
  });
}
