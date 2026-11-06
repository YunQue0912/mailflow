import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createVerificationCodeAutoCopy } from './verificationCodeAutoCopy.js';
import { extractVerificationCodes, VERIFICATION_CODE_MAX_INPUT } from './verificationCodes.js';

const NOW = Date.parse('2026-11-06T05:00:00Z');
const syntheticCodes = input => [...new Set(
  Object.values(input).flatMap(value => typeof value === 'string'
    ? [...value.matchAll(/CODE\[([A-Z0-9]+)\]/g)].map(match => match[1]) : []),
)];

function mail(id = 'm1', delta = 0, patch = {}) {
  return { id, accountId: 'account-a', folder: 'INBOX', date: new Date(NOW + delta).toISOString(), subject: 'CODE[001234]', ...patch };
}
function event(messages, patch = {}) {
  return { type: 'new_messages', folder: 'INBOX', accountId: 'account-a', messages, count: messages.length, ...patch };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function setup(overrides = {}) {
  const fixture = {
    state: { user: { id: 'user-a' }, isLocked: false }, enabled: true, focused: true,
    writes: [], fetches: [], notifications: 0,
  };
  fixture.engine = createVerificationCodeAutoCopy({
    getState: () => fixture.state,
    getEnabled: () => fixture.enabled,
    isDocumentReady: () => fixture.focused,
    now: () => NOW,
    extractCodes: syntheticCodes,
    fetchBody: async id => { fixture.fetches.push(id); return { text: '' }; },
    copyText: async code => { fixture.writes.push(code); return true; },
    onCopied: () => fixture.notifications++,
    ...overrides,
  });
  return fixture;
}

test('only enabled, signed-in, unlocked foreground sessions can auto-copy', async () => {
  for (const change of [f => { f.enabled = false; }, f => { f.state.user = null; },
    f => { f.state.isLocked = true; }, f => { f.focused = false; }]) {
    const f = setup(); change(f);
    assert.equal(await f.engine.handleNewMessages(event([mail()])), false);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.fetches, []);
  }
});

test('only fresh, announced Inbox mail is considered', async () => {
  for (const data of [
    event([mail()], { folder: 'Archive' }),
    event([mail()], { alertMessages: [], alertCount: 0 }),
    event([mail('old', -600_001)]),
    event([mail('future', 30_001)]),
    event([mail('undated', 0, { date: null })]),
    event([mail('invalid', 0, { date: 'invalid' })]),
    event([mail('filed', 0, { folder: 'Archive' })]),
    event([mail('other-account', 0, { accountId: 'account-b' })]),
  ]) {
    const f = setup();
    assert.equal(await f.engine.handleNewMessages(data), false);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.fetches, []);
  }
});

test('copies the latest unique code once, retaining leading zeroes', async () => {
  const f = setup();
  const data = event([mail('old', -1000, { subject: 'CODE[654321]' }), mail()]);
  assert.equal(await f.engine.handleNewMessages(data), true);
  assert.deepEqual(f.writes, ['001234']);
  assert.equal(f.notifications, 1);
  assert.equal(await f.engine.handleNewMessages(data), false);
  assert.deepEqual(f.writes, ['001234']);
  assert.deepEqual(f.fetches, ['m1'], 'even a unique preview is checked against the full body');
});

test('breaks equal-timestamp ties using the last appended mail', async () => {
  const f = setup();
  await f.engine.handleNewMessages(event([mail('old', 0, { subject: 'CODE[654321]' }), mail('new')]));
  assert.deepEqual(f.writes, ['001234']);
});

test('reads the full body without changing mail flags', async () => {
  const fetches = [];
  const f = setup({ fetchBody: async id => { fetches.push(id); return { text: 'CODE[001234]' }; } });
  const message = mail('body-only', 0, { subject: 'A sign-in email', is_read: false });
  assert.equal(await f.engine.handleNewMessages(event([message])), true);
  assert.deepEqual(fetches, ['body-only']);
  assert.deepEqual(f.writes, ['001234']);
  assert.equal(message.is_read, false);
});

test('ambiguous preview or body codes stay manual', async () => {
  const f = setup();
  assert.equal(await f.engine.handleNewMessages(event([mail('ambiguous', 0, { subject: 'CODE[123456] CODE[987654]' })])), false);
  assert.deepEqual(f.fetches, ['ambiguous']);
  assert.deepEqual(f.writes, []);
  const g = setup({ fetchBody: async () => ({ text: 'CODE[123456] CODE[987654]' }) });
  assert.equal(await g.engine.handleNewMessages(event([mail('body-ambiguous', 0, { subject: '' })])), false);
  assert.deepEqual(g.writes, []);
});

test('a unique preview code quoted in the full message is not copied', async () => {
  const message = mail('quoted-preview', 0, { subject: 'A sign-in notification', snippet: 'Your verification code is 123456' });
  assert.deepEqual(extractVerificationCodes(message), ['123456'], 'the short preview alone appears unambiguous');
  const f = setup({
    extractCodes: extractVerificationCodes,
    fetchBody: async () => ({ text: 'For your reference:\n> Your verification code is 123456' }),
  });
  assert.equal(await f.engine.handleNewMessages(event([message])), false);
  assert.deepEqual(f.writes, []);
});

test('a second code beyond the preview prevents auto-copy', async () => {
  const message = mail('two-full-codes', 0, { subject: 'A sign-in notification', snippet: 'Your verification code is 123456' });
  assert.deepEqual(extractVerificationCodes(message), ['123456']);
  const f = setup({
    extractCodes: extractVerificationCodes,
    fetchBody: async () => ({ text: 'Your verification code is 123456.\nYour security code is 987654.' }),
  });
  assert.equal(await f.engine.handleNewMessages(event([message])), false);
  assert.deepEqual(f.writes, []);
});

test('a genuine standalone subject code survives full-body confirmation', async () => {
  const f = setup({
    extractCodes: extractVerificationCodes,
    fetchBody: async () => ({ text: 'Use this code to complete your sign-in.' }),
  });
  assert.equal(await f.engine.handleNewMessages(event([mail('subject-code', 0, { subject: 'Your verification code: 001234' })])), true);
  assert.deepEqual(f.writes, ['001234']);
});

test('a failed or missing full body does not fall back to the preview', async () => {
  for (const fetchBody of [async () => { throw new Error('body unavailable'); }, async () => null]) {
    const f = setup({ extractCodes: extractVerificationCodes, fetchBody });
    assert.equal(await f.engine.handleNewMessages(event([mail('no-body', 0, {
      subject: 'A sign-in notification', snippet: 'Your verification code is 123456',
    })])), false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.notifications, 0);
  }
});

test('when no body loader is available, an existing full body takes priority over the snippet', async () => {
  const f = setup({ extractCodes: extractVerificationCodes, fetchBody: undefined });
  assert.equal(await f.engine.handleNewMessages(event([mail('inline-body', 0, {
    subject: 'A sign-in notification', snippet: 'Your verification code is 111111', text: 'Your verification code is 001234',
  })])), true);
  assert.deepEqual(f.writes, ['001234']);
});

test('a second code beyond the extractor scan budget prevents automatic copying', async () => {
  const text = 'Your verification code is 123456.\n'
    + ' '.repeat(VERIFICATION_CODE_MAX_INPUT) + '\nYour security code is 987654.';
  assert.deepEqual(extractVerificationCodes({ text }), ['123456'], 'bounded extraction cannot see the second code');
  for (const fetchBody of [async () => ({ text }), undefined]) {
    const f = setup({ extractCodes: extractVerificationCodes, fetchBody });
    assert.equal(await f.engine.handleNewMessages(event([mail('oversized-text', 0, {
      subject: 'A sign-in notification', snippet: 'Your verification code is 123456', text,
    })])), false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.notifications, 0);
  }
});

test('an oversized chosen HTML body or preview is not treated as fully inspected', async () => {
  for (const body of [
    { text: '', html: '<p>Verification code: 123456</p>' + ' '.repeat(VERIFICATION_CODE_MAX_INPUT) + '<p>Security code: 987654</p>' },
    { snippet: 'Verification code: 123456 ' + ' '.repeat(VERIFICATION_CODE_MAX_INPUT) + 'Security code: 987654' },
  ]) {
    const htmlBody = typeof body.html === 'string';
    let extracted = 0;
    const f = setup({
      fetchBody: htmlBody ? async () => body : undefined,
      extractCodes: input => { extracted++; return syntheticCodes(input); },
    });
    assert.equal(await f.engine.handleNewMessages(event([mail('oversized-alternative', 0, { ...body })])), false);
    assert.deepEqual(f.writes, []);
    assert.equal(extracted, 0, 'a truncated source is refused before trying to infer uniqueness');
  }
});

test('an oversized subject is refused before loading or copying the message', async () => {
  const f = setup();
  assert.equal(await f.engine.handleNewMessages(event([mail('oversized-subject', 0, {
    subject: 'Verification code: 123456 ' + ' '.repeat(VERIFICATION_CODE_MAX_INPUT) + 'Security code: 987654',
  })])), false);
  assert.deepEqual(f.fetches, []);
  assert.deepEqual(f.writes, []);
});

test('a short text part does not permit auto-copy when the alternative HTML exceeds the scan budget', async () => {
  const f = setup({
    extractCodes: extractVerificationCodes,
    fetchBody: async () => ({ text: 'Your verification code is 001234', html: '<div>' + 'x'.repeat(VERIFICATION_CODE_MAX_INPUT + 1) + '</div>' }),
  });
  assert.equal(await f.engine.handleNewMessages(event([mail('short-text', 0, { subject: 'A sign-in notification' })])), false);
  assert.deepEqual(f.writes, []);
});

test('conflicting text and HTML MIME codes are left for manual copying', async () => {
  const originalParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  const dom = new JSDOM('');
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: dom.window.DOMParser });
  try {
    const body = { text: 'Your verification code is 111111', html: '<p>Your verification code is <b>222222</b></p>' };
    assert.deepEqual(extractVerificationCodes(body), ['111111', '222222']);
    const f = setup({ extractCodes: extractVerificationCodes, fetchBody: async () => body });
    assert.equal(await f.engine.handleNewMessages(event([mail('conflicting-mime', 0, { subject: 'A sign-in notification' })])), false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.notifications, 0);
  } finally {
    if (originalParser) Object.defineProperty(globalThis, 'DOMParser', originalParser);
    else delete globalThis.DOMParser;
    dom.window.close();
  }
});

test('checks the session, preference and focus again after loading a body', async () => {
  for (const change of [f => { f.state.user = { id: 'user-b' }; }, f => { f.state.isLocked = true; },
    f => { f.enabled = false; }, f => { f.focused = false; }]) {
    const load = deferred();
    const f = setup({ fetchBody: () => load.promise });
    const pending = f.engine.handleNewMessages(event([mail('slow', 0, { subject: '' })]));
    change(f); load.resolve({ text: 'CODE[001234]' });
    assert.equal(await pending, false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.notifications, 0);
  }
});

test('cancel invalidates A -> B -> A and off -> on pending work', async () => {
  const load = deferred();
  const f = setup({ fetchBody: () => load.promise });
  const pending = f.engine.handleNewMessages(event([mail('slow', 0, { subject: '' })]));
  f.engine.cancel();
  load.resolve({ text: 'CODE[001234]' });
  assert.equal(await pending, false);
  assert.deepEqual(f.writes, []);
});

test('a slow earlier body cannot overwrite a newer code', async () => {
  const load = deferred();
  const f = setup({ fetchBody: id => id === 'old' ? load.promise : Promise.resolve({ text: '' }) });
  const old = f.engine.handleNewMessages(event([mail('old', -1000, { subject: '' })]));
  assert.equal(await f.engine.handleNewMessages(event([mail('new')])), true);
  load.resolve({ text: 'CODE[987654]' });
  assert.equal(await old, false);
  assert.deepEqual(f.writes, ['001234']);
});

test('an out-of-order older event cannot replace the newer code', async () => {
  const f = setup();
  await f.engine.handleNewMessages(event([mail('new')]));
  assert.equal(await f.engine.handleNewMessages(event([mail('old', -1000, { subject: 'CODE[987654]' })])), false);
  assert.deepEqual(f.writes, ['001234']);
});

test('clipboard writes are serialized so a delayed older write cannot finish last', async () => {
  const firstWrite = deferred();
  const firstStarted = deferred();
  const writes = [];
  const f = setup({ copyText: async code => {
    writes.push(code);
    if (writes.length === 1) { firstStarted.resolve(); return firstWrite.promise; }
    return true;
  } });
  const old = f.engine.handleNewMessages(event([mail('old', -1000, { subject: 'CODE[987654]' })]));
  await firstStarted.promise;
  const latest = f.engine.handleNewMessages(event([mail('new')]));
  await Promise.resolve();
  assert.deepEqual(writes, ['987654']);
  firstWrite.resolve(true);
  await Promise.all([old, latest]);
  assert.deepEqual(writes, ['987654', '001234']);
  assert.equal(f.notifications, 1, 'only the current code gets success feedback');
});

test('failures neither retry nor claim a successful copy', async () => {
  for (const copyText of [async () => false, async () => { throw new Error('denied'); }]) {
    let attempts = 0;
    const f = setup({ copyText: async value => { attempts++; return copyText(value); } });
    const data = event([mail()]);
    assert.equal(await f.engine.handleNewMessages(data), false);
    assert.equal(await f.engine.handleNewMessages(data), false);
    assert.equal(attempts, 1);
    assert.equal(f.notifications, 0);
  }
});

test('a bounded event considers at most five body loads and never copies without a code', async () => {
  let fetches = 0;
  const f = setup({ fetchBody: async () => { fetches++; return { text: 'No code' }; } });
  const messages = Array.from({ length: 15 }, (_, index) => mail(`m${index}`, -index, { subject: '' }));
  assert.equal(await f.engine.handleNewMessages(event(messages)), false);
  assert.equal(fetches, 5);
  assert.deepEqual(f.writes, []);
});

test('a message that expires during body loading is never copied', async () => {
  const load = deferred();
  let clock = NOW;
  const f = setup({ fetchBody: () => load.promise, now: () => clock });
  const pending = f.engine.handleNewMessages(event([mail('expires', 0, { subject: '' })]));
  clock += 600_001;
  load.resolve({ text: 'CODE[001234]' });
  assert.equal(await pending, false);
  assert.deepEqual(f.writes, []);
});

test('cancel discards pending queued copies when the app locks', async () => {
  const firstWrite = deferred();
  const firstStarted = deferred();
  const writes = [];
  const f = setup({ copyText: async code => {
    writes.push(code); firstStarted.resolve(); return firstWrite.promise;
  } });
  const first = f.engine.handleNewMessages(event([mail('first', -1000)]));
  await firstStarted.promise;
  const queued = f.engine.handleNewMessages(event([mail('queued', 0, { subject: 'CODE[987654]' })]));
  f.state.isLocked = true;
  f.engine.cancel();
  firstWrite.resolve(true);
  await Promise.all([first, queued]);
  assert.deepEqual(writes, ['001234'], 'only the write already issued before locking can complete');
  assert.equal(f.notifications, 0);
});

test('native clipboard refusal stays silent and does not use the legacy selection fallback', async () => {
  const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let modernWrites = 0;
  let legacyWrites = 0;
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      clipboard: { writeText: async () => { modernWrites++; throw new Error('not allowed'); } },
    } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      execCommand: () => { legacyWrites++; return true; },
    } });
    const f = setup({ copyText: undefined });
    assert.equal(await f.engine.handleNewMessages(event([mail()])), false);
    assert.equal(modernWrites, 1);
    assert.equal(legacyWrites, 0);
    assert.equal(f.notifications, 0);
  } finally {
    if (navigator) Object.defineProperty(globalThis, 'navigator', navigator);
    else delete globalThis.navigator;
    if (document) Object.defineProperty(globalThis, 'document', document);
    else delete globalThis.document;
  }
});

test('the remembered-message cache is bounded during a long app session', async () => {
  const f = setup();
  for (let index = 0; index < 501; index++) await f.engine.handleNewMessages(event([mail(`m${index}`)]));
  assert.equal(f.writes.length, 501);
  assert.equal(await f.engine.handleNewMessages(event([mail('m0')])), true, 'oldest remembered ID has been evicted');
  assert.equal(f.writes.length, 502);
});
