function responseError(response) {
  return response.json()
    .then(body => body?.error || null)
    .catch(() => null)
    .then(message => new Error(message || `Download failed (${response.status})`));
}

export async function downloadAttachmentFile({
  path,
  filename,
  mimeType,
  nativeBridge = globalThis.window?.mailflowNative,
  baseUrl = globalThis.window?.location?.href,
  fetchImpl = globalThis.fetch,
  documentImpl = globalThis.document,
  urlApi = globalThis.URL,
  schedule = globalThis.setTimeout,
}) {
  if (nativeBridge?.platform === 'android' && nativeBridge.attachments?.download) {
    const url = new URL(path, baseUrl).toString();
    const result = await nativeBridge.attachments.download({ url, filename, mimeType });
    if (!result?.started) throw new Error(result?.reason || 'Native download unavailable');
    return result;
  }

  const response = await fetchImpl(path, { credentials: 'include' });
  if (!response.ok) throw await responseError(response);

  const objectUrl = urlApi.createObjectURL(await response.blob());
  const anchor = documentImpl.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename || 'attachment';
  documentImpl.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  schedule(() => urlApi.revokeObjectURL(objectUrl), 1000);
  return { started: true };
}
