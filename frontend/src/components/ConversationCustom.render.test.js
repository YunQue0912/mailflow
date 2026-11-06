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
  MutationObserver: dom.window.MutationObserver,
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
const AttachmentViewer = (await import('./AttachmentViewer.jsx')).default;
const { scheduleMarkReadTimer, applyMarkRead } = await import('../utils/markRead.js');
const { _resetReadOrder, _readIntentSize } = await import('../utils/readOrder.js');

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
  _resetReadOrder();
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
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
function readServer(t, rows) {
  const flags = new Map(rows.map(item => [item.id, item.is_read]));
  const requests = [];
  let held = null;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (!String(url).endsWith('/mail/messages/bulk-read')) return new Response('{}');
    const body = JSON.parse(options.body);
    requests.push(body);
    body.ids.forEach(id => flags.set(id, body.read));
    const wait = held;
    held = null;
    if (wait) await wait.promise;
    return new Response(JSON.stringify({ updated: body.ids }));
  });
  return { flags, requests, hold: wait => { held = wait; } };
}
async function openReadThread(rows) {
  useStore.setState({ messages: rows, threadMessages: { thread: rows } });
  api.getThread = async () => ({ messages: rows });
  await render(ConversationPane, { threadId: 'thread', folder: 'INBOX', accountId: ACCOUNT.id, selectedMessageId: rows[0].id });
}

for (const Component of [ConversationMessageCard, MessagePane]) {
  for (const width of [480, 1024]) {
  test(`${Component === MessagePane ? 'single' : 'conversation'} reading at width ${width} downloads original EML through Android`, async () => {
    window.innerWidth = width;
    const item = message('11111111-1111-4111-8111-111111111111');
    const downloads = [];
    window.mailflowNative = { platform: 'android', attachments: { download: async options => { downloads.push(options); return { started: true }; } } };
    useStore.setState({ messages: [item], selectedMessageId: item.id });
    await render(Component, { message: item, expanded: true, onToggle() {} });
    if (width >= 768) {
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
  await render(ConversationMessageCard, { message: item, expanded: true, onToggle() {}, aiEnabled: true });
  await click(labelled('message.aiActions'));
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
  await render(ConversationMessageCard, { message: run.item, expanded: true, onToggle() {}, aiEnabled: true });
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

test('a later card unread wins while the whole-thread membership lookup is delayed', async t => {
  const rows = [message('first', { is_read: true }), message('second')];
  const server = readServer(t, rows);
  await openReadThread(rows);
  const lookup = deferred();
  api.getThread = () => lookup.promise;
  await click(labelled('contextMenu.markRead'));
  await click(container.querySelector('[data-message-id="first"] button[title="contextMenu.markUnread"]'));
  await React.act(async () => lookup.resolve({ messages: rows }));
  await settle();
  assert.deepEqual(server.requests, [{ ids: ['first'], read: false }, { ids: ['second'], read: true }]);
  assert.equal(server.flags.get('first'), false);
  assert.equal(useStore.getState().threadMessages.thread.find(item => item.id === 'first').is_read, false);
  assert.equal(_readIntentSize(), 0);
});

test('a later card unread survives an older whole-thread read response', async t => {
  const rows = [message('first', { is_read: true }), message('second')];
  const server = readServer(t, rows);
  await openReadThread(rows);
  const response = deferred();
  server.hold(response);
  await click(labelled('contextMenu.markRead'));
  await settle();
  await click(container.querySelector('[data-message-id="first"] button[title="contextMenu.markUnread"]'));
  await React.act(async () => response.resolve());
  await settle();
  assert.equal(server.flags.get('first'), false);
  assert.equal(server.flags.get('second'), true);
  assert.equal(useStore.getState().threadMessages.thread.find(item => item.id === 'first').is_read, false);
  assert.equal(_readIntentSize(), 0);
});

test('whole-thread unread cancels a pending automatic timer even when the lookup already says unread', async t => {
  const rows = initial.map(item => ({ ...item, is_read: true }));
  const server = readServer(t, rows);
  await openReadThread(rows);
  api.getThread = async () => ({ messages: initial });
  scheduleMarkReadTimer('first', () => api.bulkRead(['first'], true), 20);
  await click(labelled('contextMenu.markUnread'));
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  assert.deepEqual(server.requests, [{ ids: ['first', 'second'], read: false }]);
  assert.equal(server.flags.get('first'), false);
});

test('whole-thread unread supersedes an in-flight automatic read even when the lookup says unread', async t => {
  const rows = [message('first'), message('second', { is_read: true })];
  const server = readServer(t, rows);
  await openReadThread(rows);
  const response = deferred();
  server.hold(response);
  await React.act(async () => applyMarkRead(rows[0]));
  await click(labelled('contextMenu.markUnread'));
  await React.act(async () => response.resolve());
  await settle();
  assert.deepEqual(server.requests, [{ ids: ['first'], read: true }, { ids: ['first', 'second'], read: false }]);
  assert.equal(server.flags.get('first'), false);
  assert.equal(useStore.getState().threadMessages.thread.find(item => item.id === 'first').is_read, false);
});

test('a whole-thread read response does not adjust a different account view\'s category counts', async t => {
  const rows = initial.map(item => ({ ...item, category: 'primary' }));
  const server = readServer(t, rows);
  await openReadThread(rows);
  const response = deferred();
  server.hold(response);
  await click(labelled('contextMenu.markRead'));
  await settle();
  const other = message('other-message', { account_id: 'other-account', category: 'primary' });
  api.getThread = async () => ({ messages: [other] });
  await React.act(async () => useStore.setState({ selectedAccountId: 'other-account', categoryCounts: { primary: 8 } }));
  await render(ConversationPane, { threadId: 'thread', folder: 'INBOX', accountId: 'other-account' });
  await React.act(async () => response.resolve());
  await settle();
  assert.equal(server.flags.get('first'), true, 'the requested read still completed for its account');
  assert.equal(useStore.getState().categoryCounts.primary, 8, 'the new account owns the category counts');
  assert.deepEqual(useStore.getState().threadMessages.thread.map(item => item.id), ['other-message']);
});

for (const phase of ['lookup', 'response']) for (const transition of ['lock/unlock', 'sign-out/sign-in']) {
  test(`whole-thread read drops a ${phase} completion after ${transition} in the same user`, async t => {
    const server = readServer(t, initial);
    await openReadThread(initial);
    const waiting = deferred();
    if (phase === 'lookup') api.getThread = () => waiting.promise;
    else server.hold(waiting);
    await click(labelled('contextMenu.markRead'));
    await settle();
    await React.act(async () => {
      const store = useStore.getState();
      if (transition === 'lock/unlock') { store.setLocked(true); store.setLocked(false); }
      else { store.setUser(null); store.setUser({ id: 'user' }); }
    });
    await React.act(async () => waiting.resolve({ messages: initial }));
    await settle();
    assert.deepEqual(useStore.getState().threadMessages, {});
    assert.deepEqual(useStore.getState().notifications, []);
    assert.equal(server.requests.length, phase === 'lookup' ? 0 : 1);
    assert.equal(_readIntentSize(), 0);
  });
}

test('thread mark-read in an account view leaves another account untouched', async (t) => {
  const copy = message('other-copy', { account_id: 'other-account', message_id: initial[0].message_id });
  api.getThread = async () => ({ messages: [...initial, copy] });
  const calls = [];
  t.mock.method(api, 'bulkRead', async (ids, read) => { calls.push({ ids, read }); });
  await render(ConversationPane, { threadId: 'thread', folder: 'INBOX', accountId: ACCOUNT.id });
  await click(labelled('contextMenu.markRead'));
  assert.deepEqual(calls, [{ ids: ['first', 'second'], read: true }]);
  assert.equal(useStore.getState().threadMessages.thread.find(item => item.id === copy.id).is_read, false);
});

test('a new conversation member refreshes the cards while retaining an opened message', async () => {
  const props = { threadId: 'thread', folder: 'INBOX', accountId: ACCOUNT.id };
  await render(ConversationPane, { ...props, refreshKey: 'thread:2' });
  await click(container.querySelector('[data-message-id="first"] > button[aria-expanded]'));
  const arrived = message('arrived', { date: '2026-09-18T00:00:00Z' });
  api.getThread = async () => ({ messages: [...initial, arrived] });
  await render(ConversationPane, { ...props, refreshKey: 'thread:3' });
  for (const id of ['first', 'arrived']) {
    assert.equal(container.querySelector(`[data-message-id="${id}"] > button[aria-expanded]`)?.getAttribute('aria-expanded'), 'true');
  }
});

test('Android preview downloads use the native endpoint after the image bytes have loaded', async (t) => {
  const attachment = { filename: 'photo.png', type: 'image/png', part: '2', size: 8 };
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }));
  const received = [];
  window.mailflowNative = { platform: 'android' };
  await render(AttachmentViewer, { messageId: 'preview', attachments: [attachment], onClose() {}, onDownloadFallback: item => received.push(item) });
  assert.ok(document.querySelector('img'), 'the viewer has the downloaded image');
  await click(document.querySelector('button[title="message.preview.download"]'));
  assert.deepEqual(received, [attachment]);
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
