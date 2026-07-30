import { describe, expect, it } from 'vitest';
import { validateHeaderValue } from 'node:http';
import { attachmentContentDisposition, sanitizeAttachmentFilename } from './contentDisposition.js';

describe('attachmentContentDisposition', () => {
  it('keeps an ASCII fallback while preserving a Chinese filename in filename*', () => {
    const value = attachmentContentDisposition('度小满-贷款结清证明.pdf');

    expect(() => validateHeaderValue('Content-Disposition', value)).not.toThrow();
    expect(value).toContain('filename="___-______.pdf"');
    expect(value).toContain("filename*=UTF-8''%E5%BA%A6%E5%B0%8F%E6%BB%A1-");
  });

  it('removes path, control, bidi, quote, and backslash hazards', () => {
    const value = attachmentContentDisposition('../invoice\r\n\u202E".pdf');

    expect(() => validateHeaderValue('Content-Disposition', value)).not.toThrow();
    expect(value).not.toMatch(/[\r\n\u202E]/);
    expect(value).toContain('filename=".._invoice_.pdf"');
    expect(value).toContain("filename*=UTF-8''.._invoice%22.pdf");
  });

  it('provides a stable fallback for an empty filename', () => {
    expect(sanitizeAttachmentFilename('\r\n')).toBe('attachment');
    expect(attachmentContentDisposition(null)).toBe(
      "attachment; filename=\"attachment\"; filename*=UTF-8''attachment",
    );
  });
});
