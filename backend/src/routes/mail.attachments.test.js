import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { imapManager } = vi.hoisted(() => ({
  imapManager: {
    fetchAttachment: vi.fn(),
    fetchMultipleAttachments: vi.fn(),
  },
}));

vi.mock('../services/db.js', () => ({ query: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.session = { userId: 'user-1' };
    next();
  },
}));
vi.mock('../index.js', () => ({ imapManager }));

import express from 'express';
import mailRoutes from './mail.js';
import { query } from '../services/db.js';

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function messageWith(attachments) {
  return {
    id: MESSAGE_ID,
    account_id: ACCOUNT_ID,
    uid: 42,
    folder: 'INBOX',
    subject: '度小满-结清证明',
    attachments,
  };
}

function buildApp() {
  const app = express();
  app.use('/api/mail', mailRoutes);
  return app;
}

describe('attachment Content-Disposition', () => {
  let server;
  let base;

  beforeAll(async () => {
    await new Promise(resolve => {
      server = buildApp().listen(0, resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    query.mockReset();
    imapManager.fetchAttachment.mockReset();
    imapManager.fetchMultipleAttachments.mockReset();
  });

  it('downloads a single attachment with a Unicode filename', async () => {
    const attachment = {
      part: '2',
      filename: '度小满-贷款结清证明.pdf',
      type: 'application/pdf',
      size: 4,
    };
    query
      .mockResolvedValueOnce({ rows: [messageWith([attachment])] })
      .mockResolvedValueOnce({ rows: [{ id: ACCOUNT_ID }] });
    imapManager.fetchAttachment.mockResolvedValue(Buffer.from('test'));

    const response = await fetch(`${base}/api/mail/messages/${MESSAGE_ID}/attachments/2`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''%E5%BA%A6%E5%B0%8F%E6%BB%A1-",
    );
    expect(await response.text()).toBe('test');
  });

  it('downloads a ZIP with a Unicode subject', async () => {
    const attachments = [
      { part: '2', filename: '证明.pdf', type: 'application/pdf', size: 4 },
      { part: '3', filename: '流水.pdf', type: 'application/pdf', size: 4 },
    ];
    query
      .mockResolvedValueOnce({ rows: [messageWith(attachments)] })
      .mockResolvedValueOnce({ rows: [{ id: ACCOUNT_ID }] });
    imapManager.fetchMultipleAttachments.mockResolvedValue(new Map([
      ['2', Buffer.from('one')],
      ['3', Buffer.from('two')],
    ]));

    const response = await fetch(`${base}/api/mail/messages/${MESSAGE_ID}/attachments.zip`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/zip');
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''%E5%BA%A6%E5%B0%8F%E6%BB%A1-",
    );
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
