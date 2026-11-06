// Verification codes are detected locally, without sending the email to another service.
// Prefer missing an unusual code over copying a phone number, order number or quoted old code.
export const VERIFICATION_CODE_MAX_INPUT = 48_000;
const MAX_INPUT = VERIFICATION_CODE_MAX_INPUT;
const MAX_LABELS = 128;
const MAX_CODES = 4;
const LABEL = /验证码|校验码|認証コード|认证码|驗證碼|动态(?:口令|码)|一次性(?:密码|口令|代码)|登录(?:代码|码)|登入(?:代碼|碼)|安全(?:代码|码)|\b(?:(?:verification|security|authentication|confirmation|login|sign[ -]?in|one[ -]?time)\s+(?:code|passcode|password)|otp|passcode)\b/gi;
const WEAK_LABEL = /\b(?:your\s+)?code\b/gi;
const TOKEN = /(?<![A-Za-z0-9])(?:[A-Z0-9]{4}-[A-Z0-9]{4}|[A-Za-z0-9]{4,10})(?![A-Za-z0-9])/g;
const BAD_CONTEXT = /\b(?:discount|coupon|promo(?:tional)?|order\s*(?:id|number|no\.?|#)|invoice|phone|telephone|tracking|expires?|expiration|minutes?|seconds?|valid\s+for)\b|折扣|优惠|优惠券|订单(?:号|编号)|訂單(?:號|編號)|运单|快递单|手机号|电话号码|有效期|过期|分钟|秒钟/gi;
const QUOTED_INTRO = /^\s*(?:on\s+.{0,220}\bwrote\s*[:：]|.{0,180}(?:写道|寫道)\s*[:：]|[-_=–—]{3,}\s*(?:original message|forwarded message|原始邮件|原始郵件|转发邮件|轉寄郵件))/i;

function bounded(value) {
  if (typeof value !== 'string') return '';
  const slice = value.slice(0, MAX_INPUT);
  return value.length > MAX_INPUT ? slice.replace(/[A-Za-z0-9-]+$/, '') : slice;
}

function normalize(value) {
  return bounded(value).normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
}

function withoutQuotedText(value) {
  const ownLines = [];
  const lines = normalize(value).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (QUOTED_INTRO.test(line)) break;
    if (/^\s*(?:from|发件人|寄件者)\s*[:：]/i.test(line)) {
      const headers = lines.slice(index + 1, index + 10).join('\n');
      if (/^\s*(?:sent|date|发送时间|寄件日期|日期)\s*[:：]/im.test(headers)
          && /^\s*(?:subject|主题|主旨)\s*[:：]/im.test(headers)) break;
    }
    if (/^\s*>/.test(line)) continue;
    ownLines.push(line);
  }
  return ownLines.join('\n').replace(/(?:https?:\/\/|www\.)\S+|\b[^\s<>@]+@[^\s<>@]+\b/gi, ' ');
}

function inertHtml(value) {
  const source = bounded(value);
  const lower = source.toLowerCase();
  const blocked = /<(script|style|head|noscript|template|iframe|object)\b[^<>]*>/gi;
  const parts = [];
  let offset = 0;
  for (let match; (match = blocked.exec(source));) {
    parts.push(source.slice(offset, match.index));
    const close = lower.indexOf(`</${match[1].toLowerCase()}`, blocked.lastIndex);
    const end = close < 0 ? -1 : lower.indexOf('>', close);
    if (end < 0) return parts.join('');
    offset = end + 1;
    blocked.lastIndex = offset;
  }
  parts.push(source.slice(offset));
  // A parsed detached document can still load resource attributes in some browsers.
  // Keep only the attributes needed to identify quoted/hidden text. In particular no
  // src, srcdoc, href, CSS URL or event handler ever reaches DOMParser.
  return parts.join('').replace(/<([a-z][a-z0-9:-]*)([^<>]*)>/gi, (_tag, name, attributes) => {
    const kept = [];
    for (const attr of attributes.matchAll(/(?:^|\s)(class|id|aria-hidden|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
      const key = attr[1].toLowerCase();
      let content = (attr[2] ?? attr[3] ?? attr[4])
        .replace(/&#(?:x([a-f0-9]{1,6})|(\d{1,7}));?/gi, (entity, hex, decimal) => {
          const point = Number.parseInt(hex || decimal, hex ? 16 : 10);
          return point <= 0x10ffff && (point < 0xd800 || point > 0xdfff) ? String.fromCodePoint(point) : entity;
        })
        .replace(/&(colon|Tab|NewLine|nbsp|quot|apos|amp);/g, (_entity, name) => ({ colon: ':', Tab: '\t', NewLine: '\n', nbsp: ' ', quot: '"', apos: "'", amp: '&' })[name]);
      if (key === 'style') content = /display\s*:\s*none|visibility\s*:\s*hidden/i.test(content) ? 'display:none' : '';
      if (content) kept.push(`${key}="${content.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`);
    }
    if (/(?:^|\s)hidden(?:\s|=|\/|$)/i.test(attributes)) kept.push('hidden');
    return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}>`;
  });
}

function visibleHtml(html) {
  if (!html || typeof globalThis.DOMParser !== 'function') return '';
  try {
    const doc = new DOMParser().parseFromString(inertHtml(html), 'text/html');
    // Outlook's separator introduces quoted siblings rather than wrapping the quote.
    for (const marker of doc.querySelectorAll('#divRplyFwdMsg')) {
      let current = marker;
      while (current && current !== doc.body) {
        while (current.nextSibling) current.nextSibling.remove();
        const parent = current.parentNode;
        if (current === marker) current.remove();
        current = parent;
      }
    }
    doc.querySelectorAll('script, style, head, noscript, template, blockquote, [hidden], [aria-hidden="true"], [class*="gmail_quote"], [class*="gmail_attr"], [class*="yahoo_quoted"], #divRplyFwdMsg')
      .forEach(node => node.remove());
    // Drop common inline hidden/preheader content too; it may contain a different old code.
    doc.querySelectorAll('[style]').forEach(node => {
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) node.remove();
    });
    // textContent glues adjacent blocks together. Inserting text-only separators does not
    // execute the document or load remote images, and keeps a code in its own paragraph.
    doc.querySelectorAll('br, p, div, td, th, tr, li, h1, h2, h3, h4, pre, section')
      .forEach(node => { node.before(doc.createTextNode('\n')); node.after(doc.createTextNode('\n')); });
    return withoutQuotedText(doc.body?.textContent || '');
  } catch {
    // Ignoring malformed HTML is safer than a tag-strip fallback that includes old quotes.
    return '';
  }
}

function isCode(value) {
  if (/^\d{4,8}$/.test(value)) return true;
  if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value)) return /[A-Z]/.test(value);
  return /^[A-Za-z0-9]{6,10}$/.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function candidates(value, offset = 0) {
  const found = [];
  for (const match of value.matchAll(TOKEN)) {
    if (!isCode(match[0])) continue;
    const before = value.slice(Math.max(0, match.index - 2), match.index);
    const after = value.slice(match.index + match[0].length, match.index + match[0].length + 2);
    // A year or a chunk of a hyphenated phone number is not a stand-alone code.
    if (/\d[-/.]$/.test(before) || /^[-/.]\d/.test(after)) continue;
    found.push({ value: match[0], start: offset + match.index, end: offset + match.index + match[0].length });
  }
  return found;
}

function hasBadContext(value) {
  BAD_CONTEXT.lastIndex = 0;
  return BAD_CONTEXT.test(value);
}

function collectByLabels(text, labels, add) {
  labels.lastIndex = 0;
  let count = 0;
  for (const label of text.matchAll(labels)) {
    if (++count > MAX_LABELS) break;
    const end = label.index + label[0].length;
    const after = text.slice(end, end + 88);
    let previousEnd = null;
    for (const candidate of candidates(after)) {
      const gap = after.slice(0, candidate.start);
      if (gap.length > 72 || /[.!?。！？]/.test(gap) || hasBadContext(gap)) break;
      // A label may explicitly offer alternatives. Retain all parallel candidates,
      // otherwise auto-copy could mistake the first of two codes for a unique match.
      if (previousEnd !== null && !/^\s*(?:(?:[,，、/]|\bor\b|\band\b|或者|或|及|和)\s*)?$/i.test(after.slice(previousEnd, candidate.start))) break;
      // Labels on an order/discount line do not turn that line's unrelated number into OTP.
      const linePrefix = text.slice(Math.max(text.lastIndexOf('\n', label.index) + 1, label.index - 45), label.index);
      if (!hasBadContext(linePrefix)) add(candidate.value);
      previousEnd = candidate.end;
    }
    const beforeStart = Math.max(0, label.index - 40);
    const before = text.slice(beforeStart, label.index);
    for (const candidate of candidates(before)) {
      const gap = before.slice(candidate.end);
      const start = beforeStart + candidate.start;
      const prefix = text.slice(Math.max(text.lastIndexOf('\n', start) + 1, start - 45), start);
      if (!hasBadContext(prefix) && !hasBadContext(gap)
          && /^\s*(?:(?:is|as)\s+(?:your\s+)?(?:[A-Za-z][A-Za-z0-9 ._-]{0,24}\s+)?|(?:是|为|為)(?:您|你)的(?:\s*[A-Za-z][A-Za-z0-9 ._-]{0,24})?)?\s*[:：,，-]?\s*$/i.test(gap)) add(candidate.value);
    }
  }
}

/** Extract up to four distinct, explicitly contextualized codes, retaining leading zeroes. */
export function extractVerificationCodes({ subject = '', snippet = '', text = '', html = '' } = {}) {
  const result = [];
  const add = value => { if (result.length < MAX_CODES && !result.includes(value)) result.push(value); };
  const title = withoutQuotedText(subject);
  // A replied-to verification email commonly retains an expired code in its subject.
  const isReply = /^\s*(?:re|fw|fwd|aw|sv|回复|回覆|转发)\s*[:：]/i.test(title);
  const ownTitle = isReply ? '' : title;
  LABEL.lastIndex = 0;
  const titleIsVerification = LABEL.test(ownTitle);
  collectByLabels(ownTitle, LABEL, add);

  const contents = [];
  const plain = bounded(text);
  const markup = bounded(html);
  // Multipart alternatives occasionally disagree. Keep their distinct candidates so
  // a visible HTML code cannot be silently displaced by a different plain-text code.
  if (plain.trim()) contents.push(/<(?:!doctype|html|body|p|div|span|table|script|style)\b/i.test(plain)
    ? visibleHtml(plain) : withoutQuotedText(plain));
  if (markup.trim()) contents.push(visibleHtml(markup));
  if (!plain.trim() && !markup.trim()) {
    let content = isReply ? '' : withoutQuotedText(snippet);
    // A long preview can cut a code mid-number. The full body will identify it on opening.
    if (content.length >= 180) content = content.replace(/[A-Za-z0-9-]+$/, '');
    contents.push(content);
  }
  for (const content of contents) {
    collectByLabels(content, LABEL, add);
    if (titleIsVerification && !hasBadContext(ownTitle)) {
      collectByLabels(content, WEAK_LABEL, add);
      // Many HTML messages put the code alone in a large heading below their subject.
      for (const line of content.split('\n').slice(0, 256)) {
        const value = line.trim();
        if (isCode(value)) add(value);
      }
    }
  }
  return result;
}
