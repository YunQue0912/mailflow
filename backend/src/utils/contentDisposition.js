// Build a Content-Disposition value that is valid for Node's HTTP header writer.
// The legacy filename parameter must be ASCII; filename* carries the real UTF-8 name.
export function sanitizeAttachmentFilename(name) {
  if (!name) return 'attachment';

  const cleaned = String(name)
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex -- header and filesystem control chars are unsafe
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[‪-‮⁦-⁩‏؜]/g, '')
    .trim()
    .substring(0, 255);

  return cleaned || 'attachment';
}

function asciiFallback(filename) {
  const fallback = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim()
    .substring(0, 255);

  return fallback || 'attachment';
}

function encode5987(filename) {
  return encodeURIComponent(filename).replace(/['()*]/g, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function attachmentContentDisposition(name) {
  const filename = sanitizeAttachmentFilename(name);
  return `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encode5987(filename)}`;
}
