// Verification codes are detected locally, without sending the email to another service.
// Prefer missing an unusual code over copying a phone number, order number or quoted old code.
export const VERIFICATION_CODE_MAX_INPUT = 48_000;
const MAX_INPUT = VERIFICATION_CODE_MAX_INPUT;
const MAX_LABELS = 128;
const MAX_CODES = 4;
const MAX_CANDIDATES = 512;
const LABEL = /验证码|验证代码|校验码|認証コード|认证码|驗證碼|动态(?:口令|码)|一次性(?:密码|口令|代码)|登录(?:代码|码)|登入(?:代碼|碼)|安全(?:代码|码)|身份确认码|\b(?:(?:verification|security|authentication|confirmation|login|sign[ -]?in|one[ -]?time)\s+(?:code|passcode|password|pin)|(?:security|authentication)\s+number|otp|passcode)\b/gi;
const WEAK_LABEL = /\b(?:your\s+)?code\b/gi;
const PIN_LABEL = /\bpin\b/gi;
const TOKEN = /(?<![A-Za-z0-9])(?:[A-Z0-9]{4}-[A-Z0-9]{4}|[A-Za-z0-9]{4,10})(?![A-Za-z0-9])/g;
const BAD_CONTEXT = /\b(?:discount|coupon|promo(?:tional)?|order\s*(?:id|number|no\.?|#)|invoice|phone|telephone|tracking|expires?|expiration|minutes?|seconds?|valid\s+for)\b|折扣|优惠|优惠券|订单(?:号|编号)|訂單(?:號|編號)|运单|快递单|手机号|电话号码|有效期|过期|分钟|秒钟/gi;
const AUTH_CONTEXT = /\b(?:sign[ -]?in|signing\s+in|log[ -]?in|logging\s+in|authentication|authenticate|one[ -]?time|password\s+reset|reset\s+(?:your\s+)?password|(?:confirm|verify|prove|validate).{0,32}(?:identity|it\s+is\s+you|it['’]s\s+you|yourself|email|account))\b|(?:确认|驗證|验证|核实).{0,10}(?:身份|本人|是您|是你|邮箱|郵箱|电子邮件|账户|帐户)|(?:完成|继续|繼續|进行|用于).{0,10}(?:登录|登入|验证)|登录|登入|身份认证|重置密码/i;
const CHALLENGE_CONTEXT = /\b(?:(?:confirm|verify|prove|validate).{0,32}(?:identity|it\s+is\s+you|it['’]s\s+you|yourself|email|account)|(?:finish|complete|continue|enable|authorize).{0,35}(?:sign[ -]?in|signing\s+in|log[ -]?in|logging\s+in|authentication)|(?:sign[ -]?in|log[ -]?in)\s+to\s+(?:your|the)\s+account|password\s+reset|reset\s+(?:your\s+)?password)\b|(?:确认|驗證|验证|核实).{0,10}(?:身份|本人|是您|是你|邮箱|郵箱|电子邮件|账户|帐户)|(?:完成|继续|繼續|进行|用于).{0,10}(?:登录|登入|验证)|重置密码/i;
const INPUT_ACTION = /\b(?:enter|type|input|use|paste|submit)\b|输入|輸入|填入|填写|填寫|键入|使用|粘贴|貼上/i;
const EXPIRY_CONTEXT = /\b(?:expires?|valid)\b.{0,35}\b(?:minutes?|seconds?|hours?)\b|(?:\d{1,3}|[一二三四五六七八九十两]{1,3})\s*(?:分钟|分鐘|秒钟|秒|小时|小時).{0,8}(?:有效|过期|到期)|(?:有效|过期|到期).{0,15}(?:分钟|分鐘|秒|小时|小時)/i;
const EDITORIAL_CONTEXT = /\b(?:newsletter|digest|tutorial|how[ -]to|(?:security|authentication)\s+(?:news|report|bulletin)|sample\s+(?:code|number)|(?:for|an|this)\s+example)\b|\b(?:example|demo)\s*:|安全(?:新闻|周报|指南)|教程|示例|例如|举例/i;
const METADATA_CONTEXT = /\b(?:zip(?:\s+code)?|postal(?:\s+code)?|(?:order|case|ticket|reference)\s*(?:id|number|no\.?|#)|invoice|phone|telephone|tracking|coupon|discount|promo(?:tional)?)\b|邮编|郵編|郵遞區號|订单(?:号|编号)|訂單(?:號|編號)|工单号|案件编号|运单|快递单|手机号|电话号码|折扣|优惠|优惠券/i;
const IDENTITY_METADATA = /\b(?:(?:reference|case|ticket)(?:\s+(?:id|number|no\.?))?|(?:account|user|customer|member)\s+(?:id|number|reference|ref|no\.?)|customer\s+ref)\b|(?:客服|工单|案件|账户|帐户|账号|帐号|用户|客户)(?:的|\s)*(?:参考(?:号|编号)?|编号|号码|号|ID|标识)|参考(?:号码|编号|号)/i;
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
      if (key === 'style') {
        if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(content)) content = 'display:none';
        else {
          const safeStyles = [];
          for (const style of content.matchAll(/(?:^|;)\s*(font-size|font-weight|letter-spacing)\s*:\s*(\d{1,3}(?:\.\d{1,2})?)(px|pt|em|rem)?\s*(?=;|$)/gi)) {
            const property = style[1].toLowerCase();
            const amount = Number(style[2]);
            const unit = (style[3] || '').toLowerCase();
            if (property === 'font-weight' ? !unit && amount >= 100 && amount <= 900 : !!unit && amount <= 100) safeStyles.push(`${property}:${amount}${unit}`);
          }
          content = safeStyles.join(';');
        }
      }
      if (content) kept.push(`${key}="${content.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`);
    }
    if (/(?:^|\s)hidden(?:\s|=|\/|$)/i.test(attributes)) kept.push('hidden');
    return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}>`;
  });
}

function visibleHtml(html) {
  const empty = () => ({ text: '', prominent: new Set() });
  if (!html || typeof globalThis.DOMParser !== 'function') return empty();
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
    doc.querySelectorAll('script, style, head, noscript, template, footer, address, blockquote, [hidden], [aria-hidden="true"], [class*="gmail_quote"], [class*="gmail_attr"], [class*="yahoo_quoted"], #divRplyFwdMsg')
      .forEach(node => node.remove());
    // Drop common inline hidden/preheader content too; it may contain a different old code.
    doc.querySelectorAll('[style]').forEach(node => {
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) node.remove();
    });
    const prominent = new Set();
    doc.querySelectorAll('h1, h2, h3, h4, b, strong, code, pre, [style]').forEach(node => {
      const value = normalize(node.textContent || '').trim();
      if (!isCode(value)) return;
      const style = node.getAttribute('style') || '';
      const size = style.match(/font-size:(\d+(?:\.\d+)?)(px|pt|em|rem)/);
      const large = size && Number(size[1]) >= (size[2] === 'px' ? 20 : size[2] === 'pt' ? 15 : 1.3);
      if (/^(?:H[1-4]|B|STRONG|CODE|PRE)$/.test(node.tagName) || large || /font-weight:[6-9]00|letter-spacing:/.test(style)) prominent.add(value);
    });
    // textContent glues adjacent blocks together. Inserting text-only separators does not
    // execute the document or load remote images, and keeps a code in its own paragraph.
    doc.querySelectorAll('br, p, div, td, th, tr, li, h1, h2, h3, h4, pre, section')
      .forEach(node => { node.before(doc.createTextNode('\n')); node.after(doc.createTextNode('\n')); });
    return { text: withoutQuotedText(doc.body?.textContent || ''), prominent };
  } catch {
    // Ignoring malformed HTML is safer than a tag-strip fallback that includes old quotes.
    return empty();
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
      if (!hasBadContext(linePrefix)) add(candidate.value, { start: end + candidate.start, end: end + candidate.end });
      previousEnd = candidate.end;
    }
    const beforeStart = Math.max(0, label.index - 40);
    const before = text.slice(beforeStart, label.index);
    for (const candidate of candidates(before)) {
      const gap = before.slice(candidate.end);
      const start = beforeStart + candidate.start;
      const prefix = text.slice(Math.max(text.lastIndexOf('\n', start) + 1, start - 45), start);
      if (!hasBadContext(prefix) && !hasBadContext(gap)
          && /^\s*(?:(?:is|as)\s+(?:your\s+)?(?:[A-Za-z][A-Za-z0-9 ._-]{0,24}\s+)?|(?:是|为|為)(?:您|你)的(?:\s*[A-Za-z][A-Za-z0-9 ._-]{0,24})?)?\s*[:：,，-]?\s*$/i.test(gap)) add(candidate.value, { start, end: beforeStart + candidate.end });
    }
  }
  return count > MAX_LABELS;
}

function candidateContext(text, position) {
  const lineStart = text.lastIndexOf('\n', position.start) + 1;
  const lineEnd = text.indexOf('\n', position.end);
  return {
    line: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd),
    prefix: text.slice(Math.max(lineStart, position.start - 85), position.start),
    nearby: text.slice(Math.max(0, position.start - 180), position.end + 180),
  };
}

function irrelevantCandidate(value, text, position) {
  const context = candidateContext(text, position);
  if (EDITORIAL_CONTEXT.test(context.nearby) || METADATA_CONTEXT.test(context.prefix)) return true;
  // A sign-in subject does not turn a permanent account ID or a support reference
  // into an OTP. Check both sides in the same sentence, including "as your reference".
  const preceding = text.slice(Math.max(0, position.start - 120), position.start).split(/[\n.!?;。！？；]/).at(-1);
  const following = text.slice(position.end, position.end + 120).split(/[\n.!?;。！？；]/)[0];
  if (IDENTITY_METADATA.test(`${preceding}${value}${following}`)) return true;
  if (/\b(?:expires?\s+in|valid\s+for)\s*$|(?:有效期|过期时间|分钟|秒钟)\s*[:：]?\s*$/i.test(context.prefix)) return true;
  // A short postal footer following a US address must not become a sign-in candidate.
  if (/^\d{5}(?:-\d{4})?$/.test(value)) {
    const before = text.slice(Math.max(0, position.start - 110), position.start);
    if (/\b[A-Z]{2}[, \t]*$/.test(before.trimEnd())
        || /\b(?:street|avenue|boulevard|road|way|suite|postal|zip)\b/i.test(before)) return true;
  }
  return false;
}

// Evidence is intentionally small and inspectable: explicit code labels are high;
// unlabelled values need both an authentication context and an input/use instruction
// for high confidence. A challenge with an isolated/emphasized value is medium only.
function analyzeVerificationCodes({ subject = '', snippet = '', text = '', html = '' } = {}) {
  const result = new Map();
  const participatingInputs = [subject, text, html];
  if (!bounded(text).trim() && !bounded(html).trim()) participatingInputs.push(snippet);
  let incomplete = participatingInputs.some(value => typeof value === 'string' && value.length > MAX_INPUT);
  const add = (value, level) => {
    if (!result.has(value) && result.size < MAX_CODES) result.set(value, level);
    else if (result.has(value) && level === 'high') result.set(value, level);
  };
  const title = withoutQuotedText(subject);
  // A replied-to verification email commonly retains an expired code in its subject.
  const isReply = /^\s*(?:re|fw|fwd|aw|sv|回复|回覆|转发)\s*[:：]/i.test(title);
  const ownTitle = isReply ? '' : title;
  if (EDITORIAL_CONTEXT.test(ownTitle) || /\b(?:discount|coupon|promo(?:tional)?)\b|折扣|优惠券/i.test(ownTitle)) return { result, incomplete };
  LABEL.lastIndex = 0;
  const titleIsVerification = LABEL.test(ownTitle);
  incomplete = collectByLabels(ownTitle, LABEL, (value, position) => {
    if (!irrelevantCandidate(value, ownTitle, position)) add(value, 'high');
  }) || incomplete;

  const contents = [];
  const plain = bounded(text);
  const markup = bounded(html);
  // Multipart alternatives occasionally disagree. Keep their distinct candidates so
  // a visible HTML code cannot be silently displaced by a different plain-text code.
  if (plain.trim()) contents.push(/<(?:!doctype|html|body|p|div|span|table|script|style)\b/i.test(plain)
    ? visibleHtml(plain) : { text: withoutQuotedText(plain), prominent: new Set() });
  if (markup.trim()) contents.push(visibleHtml(markup));
  if (!plain.trim() && !markup.trim()) {
    let content = isReply ? '' : withoutQuotedText(snippet);
    // A long preview can cut a code mid-number. The full body will identify it on opening.
    if (content.length >= 180) content = content.replace(/[A-Za-z0-9-]+$/, '');
    contents.push({ text: content, prominent: new Set() });
  }
  for (const part of contents) {
    const content = part.text;
    const contextual = titleIsVerification || AUTH_CONTEXT.test(`${ownTitle}\n${content}`);
    incomplete = collectByLabels(content, LABEL, (value, position) => {
      if (!irrelevantCandidate(value, content, position)) add(value, 'high');
    }) || incomplete;
    if (contextual) {
      for (const label of [WEAK_LABEL, PIN_LABEL]) {
        incomplete = collectByLabels(content, label, (value, position) => {
          if (!irrelevantCandidate(value, content, position)) add(value, titleIsVerification ? 'high' : 'medium');
        }) || incomplete;
      }
    }
    const values = candidates(content);
    if (values.length > MAX_CANDIDATES) incomplete = true;
    for (const candidate of values.slice(0, MAX_CANDIDATES)) {
      const { value } = candidate;
      if (irrelevantCandidate(value, content, candidate)) continue;
      const context = candidateContext(content, candidate);
      const isolated = context.line.trim() === value;
      const layout = isolated || part.prominent.has(value);
      const nearby = `${ownTitle}\n${context.nearby}`;
      const auth = titleIsVerification || AUTH_CONTEXT.test(nearby);
      const challenge = CHALLENGE_CONTEXT.test(nearby);
      const instruction = INPUT_ACTION.test(context.nearby);
      const directedInput = /(?:\b(?:enter|type|input|use|paste|submit)\b|输入|輸入|填入|填写|填寫|键入|使用|粘贴|貼上)[^\n.!?。！？]{0,60}$/i.test(context.prefix);
      const directEntry = /(?:\b(?:enter|type|input|paste|submit)\b|输入|輸入|填入|填写|填寫|键入|粘贴|貼上)[^\n.!?。！？]{0,60}$/i.test(context.prefix);
      const directsCode = /(?:\buse\b[^.!?。！？]{0,40}\b(?:code|pin|digits|numbers?)\b|使用[^.!?。！？]{0,20}(?:数字|代码|码))[^.!?。！？]{0,40}$/i.test(content.slice(Math.max(0, candidate.start - 120), candidate.start))
        || /^\s*(?:[.!?。！？]\s*)?(?:use\s+this\s+(?:code|pin|number)|使用(?:此|这个)(?:数字|代码|码))/i.test(content.slice(candidate.end, candidate.end + 80));
      const bodyAuth = AUTH_CONTEXT.test(context.nearby);
      const bodyChallenge = CHALLENGE_CONTEXT.test(context.nearby);
      const expires = EXPIRY_CONTEXT.test(context.nearby);
      const inferable = /^\d{6,8}$/.test(value) || /[A-Za-z]/.test(value)
        || (/^\d{4,5}$/.test(value) && /\bpin\b/i.test(context.nearby));
      if (!inferable) continue;
      if (titleIsVerification && layout && !hasBadContext(ownTitle)) add(value, 'high');
      else if (auth && instruction && (directEntry || directsCode || bodyChallenge
          || ((bodyAuth || titleIsVerification) && directedInput))) add(value, 'high');
      else if (auth && layout && (challenge || expires)) add(value, 'medium');
    }
  }
  return { result, incomplete };
}

/** Local high/medium evidence candidates for a user to inspect and copy manually. */
export function extractVerificationCodes(input) {
  return [...analyzeVerificationCodes(input).result.keys()];
}

/** Auto-copy only a single high-evidence code; do not hide weaker conflicting values. */
export function extractReliableVerificationCodes(input) {
  const { result, incomplete } = analyzeVerificationCodes(input);
  if (incomplete || result.size !== 1) return [];
  for (const [value, level] of result) {
    if (level === 'high') return [value];
  }
  return [];
}
