import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadAttachmentFile } from './attachmentDownload.js';

test('uses the Android native bridge with an absolute attachment URL', async () => {
  let received;
  const result = await downloadAttachmentFile({
    path: '/api/mail/messages/id/attachments/2',
    filename: '证明.pdf',
    mimeType: 'application/pdf',
    baseUrl: 'https://mail.example.test/inbox',
    nativeBridge: {
      platform: 'android',
      attachments: {
        download: async options => {
          received = options;
          return { started: true, id: 7 };
        },
      },
    },
  });

  assert.deepEqual(received, {
    url: 'https://mail.example.test/api/mail/messages/id/attachments/2',
    filename: '证明.pdf',
    mimeType: 'application/pdf',
  });
  assert.equal(result.id, 7);
});

test('downloads a successful response and revokes the Blob URL after handoff', async () => {
  const events = [];
  const anchor = {
    click: () => events.push('click'),
    remove: () => events.push('remove'),
  };

  await downloadAttachmentFile({
    path: '/attachment',
    filename: 'report.pdf',
    nativeBridge: null,
    fetchImpl: async () => ({ ok: true, blob: async () => ({ bytes: 1 }) }),
    documentImpl: {
      createElement: () => anchor,
      body: { appendChild: () => events.push('append') },
    },
    urlApi: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: url => events.push(`revoke:${url}`),
    },
    schedule: callback => {
      events.push('schedule');
      callback();
    },
  });

  assert.equal(anchor.href, 'blob:test');
  assert.equal(anchor.download, 'report.pdf');
  assert.deepEqual(events, ['append', 'click', 'remove', 'schedule', 'revoke:blob:test']);
});

test('surfaces the server error instead of silently swallowing it', async () => {
  await assert.rejects(
    downloadAttachmentFile({
      path: '/attachment',
      nativeBridge: null,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Failed to fetch attachment' }),
      }),
    }),
    /Failed to fetch attachment/,
  );
});
