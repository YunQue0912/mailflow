import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractReliableVerificationCodes, extractVerificationCodes } from './verificationCodes.js';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser;

describe('verification code extraction', () => {
  test('Chinese code retains leading zeroes and normalizes full-width text', () => {
    assert.deepEqual(extractVerificationCodes({ text: '您的验证码为：００１２３４，五分钟内有效。' }), ['001234']);
  });

  test('English and mixed case codes preserve their exact value', () => {
    assert.deepEqual(extractVerificationCodes({ text: 'Your verification code is aB9k2P. Do not share it.' }), ['aB9k2P']);
    assert.deepEqual(extractVerificationCodes({ text: 'One-time passcode: 8392' }), ['8392']);
    assert.deepEqual(extractVerificationCodes({ text: 'Security code: ABCD-EFGH' }), ['ABCD-EFGH']);
  });

  test('a direct input operation and authentication purpose identify an unlabelled code', () => {
    for (const input of [
      { subject: 'Sign in to your account', text: 'Enter 046281 to finish signing in. This expires in 10 minutes.' },
      { subject: 'Account authentication', text: 'Enter 004782 for authentication.' },
      { subject: '身份认证', text: '请输入 058214 进行身份认证。' },
      { subject: 'Your Example code', text: 'Your code is 004782. Enter it in the browser to continue signing in.' },
      { subject: 'New login attempt', text: 'Your one-time PIN is 004782. If you did not request it, ignore this email.' },
    ]) {
      const manual = extractVerificationCodes(input);
      assert.equal(manual.length, 1);
      assert.deepEqual(extractReliableVerificationCodes(input), manual);
    }
  });

  test('HTML layout supports identity instructions without relying on a literal code keyword', () => {
    const input = {
      subject: 'Confirm it is you',
      html: '<p>Use the following numbers to verify your identity.</p>'
        + '<div style="font-size:28px;font-weight:700;letter-spacing:3px;background:url(https://example.test/image)">058214</div>'
        + '<p>Valid for 10 minutes. If you did not request this, ignore this email.</p>',
    };
    assert.deepEqual(extractVerificationCodes(input), ['058214']);
    assert.deepEqual(extractReliableVerificationCodes(input), ['058214']);
  });

  test('identity context and prominent typography without an instruction remain manual only', () => {
    const input = { subject: 'Confirm it is you', html: '<p>Your number is <span style="font-size:28px;font-weight:700">058214</span>.</p>' };
    assert.deepEqual(extractVerificationCodes(input), ['058214']);
    assert.deepEqual(extractReliableVerificationCodes(input), []);
    assert.deepEqual(extractVerificationCodes({ subject: 'Your weekly statistics', html: '<h2>058214</h2>' }), []);
  });

  test('a high-evidence value cannot become auto-copyable by discarding a weaker candidate', () => {
    const input = { subject: 'Confirm your identity', text: 'Security code: 111111\n\n222222' };
    assert.deepEqual(extractVerificationCodes(input), ['111111', '222222']);
    assert.deepEqual(extractReliableVerificationCodes(input), []);
    assert.deepEqual(extractReliableVerificationCodes({ text: 'Verification code: 001234' }), ['001234']);
  });

  test('the reliable helper independently rejects every participating truncated input', () => {
    for (const input of [
      { subject: `Verification code: 001234 ${'x'.repeat(60_000)}` },
      { text: `Verification code: 001234 ${'x'.repeat(60_000)}` },
      { html: `<p>Verification code: 001234</p>${' '.repeat(60_000)}` },
      { snippet: `Verification code: 001234 ${'x'.repeat(60_000)}` },
    ]) {
      assert.deepEqual(extractVerificationCodes(input), ['001234']);
      assert.deepEqual(extractReliableVerificationCodes(input), []);
    }
    assert.deepEqual(extractReliableVerificationCodes({ text: 'Verification code: 001234', snippet: 'x'.repeat(60_000) }), ['001234']);
  });

  test('security news, tutorials, examples, metadata and login alerts do not become challenges', () => {
    for (const input of [
      { subject: 'Security news', html: '<p>Account authentication report.</p><h2>123456</h2><p>New sign-in events this year.</p>' },
      { subject: 'Tutorial: sign-in confirmation', text: 'Enter 123456 to finish signing in.' },
      { text: 'For example, your verification code might be 123456.' },
      { subject: 'Sign in to your account', text: 'Enter order number 123456 to continue signing in.' },
      { subject: 'New login alert', text: 'Use case number 123456 when contacting support. Login was successful.' },
      { subject: 'Account sign-in notification', text: 'You signed in successfully.\nExample Corporation\nOne Example Way\nRedmond, WA 98052' },
    ]) {
      assert.deepEqual(extractVerificationCodes(input), [], JSON.stringify(input));
      assert.deepEqual(extractReliableVerificationCodes(input), []);
    }
  });

  test('support references and permanent account identifiers are not sign-in codes', () => {
    for (const input of [
      { subject: 'New login attempt', text: 'Your account was accessed. If you contact support, use reference 123456.' },
      { subject: 'Sign in to your account', text: 'We sent you a link. To contact support, use 123456 as your reference.' },
      { subject: 'Sign in to your account', text: 'Please use customer reference 654321 when you contact our support team.' },
      { subject: 'Welcome - sign in to your account', text: 'Account number: 123456. Use this number to sign in.' },
      { subject: 'Welcome - sign in to your account', text: 'User ID: 654321. Use this ID to sign in to your account.' },
      { subject: '登录到您的账户', text: '请使用 123456 作为您的客服参考号。' },
      { subject: '登录到您的账户', text: '账户编号：123456。请使用此编号登录。' },
      { subject: 'Sign in to your account', text: 'Use 123456 to view the company profile.' },
    ]) {
      assert.deepEqual(extractVerificationCodes(input), [], JSON.stringify(input));
      assert.deepEqual(extractReliableVerificationCodes(input), []);
    }
  });

  test('specific code-use and sign-in input instructions retain reliable evidence', () => {
    for (const input of [
      { subject: 'Sign in to your account', text: 'Use code 046281 to continue.' },
      { subject: 'Sign in to your account', text: 'Enter 046281 to finish signing in.' },
      { subject: 'Verification code', text: 'Use 046281.' },
      { subject: 'Sign in to your account', text: '046281\nUse this code to sign in.' },
      { subject: 'Sign in to your account', text: 'Security code: 046281. Your customer reference is 654321.' },
    ]) {
      assert.deepEqual(extractVerificationCodes(input), ['046281'], JSON.stringify(input));
      assert.deepEqual(extractReliableVerificationCodes(input), ['046281']);
    }
  });

  test('recognizes code before its label', () => {
    assert.deepEqual(extractVerificationCodes({ text: '123456 is your verification code.' }), ['123456']);
    assert.deepEqual(extractVerificationCodes({ text: '001234 是您的验证码。' }), ['001234']);
    assert.deepEqual(extractVerificationCodes({ text: 'G-001234是您的Google验证码。' }), ['001234']);
  });

  test('subject context allows a standalone code, with body preferred over truncated preview', () => {
    assert.deepEqual(extractVerificationCodes({ subject: 'Your sign-in code', text: 'Welcome\n\n000987\n\nUse it to sign in.', snippet: 'Your code is 0009' }), ['000987']);
    assert.deepEqual(extractVerificationCodes({ subject: 'Authentication code', text: 'Your code is: 567890' }), ['567890']);
  });

  test('HTML entities, formatting tags and block boundaries are read without executing content', () => {
    assert.deepEqual(extractVerificationCodes({
      subject: 'Your verification code',
      html: '<html><body><p>Your verification code is:</p><h2><b>00</b>12&#51;4</h2><p>Do not share.</p></body></html>',
    }), ['001234']);
  });

  test('multipart alternatives retain conflicting codes and deduplicate matching ones', () => {
    assert.deepEqual(extractVerificationCodes({ subject: 'Your verification code', text: '111111', html: '<p>222222</p>' }), ['111111', '222222']);
    assert.deepEqual(extractVerificationCodes({ subject: 'Verification code: 001234', text: 'Your verification code is 001234', html: '<p>Verification code: 001234</p>' }), ['001234']);
  });

  test('multipart quote filtering never falls back to an old code in the snippet', () => {
    assert.deepEqual(extractVerificationCodes({ subject: 'Verification code', text: 'Your verification code is 111111', html: '<blockquote>Verification code: 222222</blockquote>', snippet: 'Verification code: 333333' }), ['111111']);
    assert.deepEqual(extractVerificationCodes({ subject: 'Verification code', text: '> Verification code: 111111', html: '<p>Verification code: 222222</p>' }), ['222222']);
    assert.deepEqual(extractVerificationCodes({ subject: 'Verification code', text: '> Verification code: 111111', html: '<blockquote>Verification code: 222222</blockquote>', snippet: 'Verification code: 333333' }), []);
  });

  test('ignores HTML old quotes, hidden preheaders, script and styles', () => {
    assert.deepEqual(extractVerificationCodes({
      subject: 'Verification code',
      html: '<style>verification code 111111</style><script>security code 222222</script>'
        + '<p hidden>Verification code: 333333</p><p style="display: none">Verification code 444444</p>'
        + '<p style="display&#58;none">Verification code 555555</p>'
        + '<p>Verification code: 005678</p><blockquote>Verification code: 123456</blockquote>'
        + '<div class="gmail_quote">Verification code: 654321</div><div class="gmail_quo&#116;e">Verification code: 888888</div>',
    }), ['005678']);
  });

  test('does not pass network or event attributes to the inert HTML parser', () => {
    const original = globalThis.DOMParser;
    let parsedSource = '';
    globalThis.DOMParser = class {
      parseFromString(source, type) {
        parsedSource = source;
        return new original().parseFromString(source, type);
      }
    };
    try {
      assert.deepEqual(extractVerificationCodes({ html: '<style>@import "https://example.test/style";</style>'
        + '<img src="https://example.test/track" onerror="alert(1)">'
        + '<iframe srcdoc="anything">verification code 123456</iframe>'
        + '<div style="background:url(https://example.test/image)">verification code 008899</div>' }), ['008899']);
      assert.doesNotMatch(parsedSource, /https:|src|onerror|background|iframe|@import/);
    } finally {
      globalThis.DOMParser = original;
    }
  });

  test('does not suggest old quoted plain text, including a message containing only quotes', () => {
    assert.deepEqual(extractVerificationCodes({ text: '验证码：009988\n> 验证码：123456\n> 验证码：654321' }), ['009988']);
    assert.deepEqual(extractVerificationCodes({ subject: 'Verification code', text: '> Verification code: 123456' }), []);
    assert.deepEqual(extractVerificationCodes({ text: 'Thanks!\nOn Monday somebody wrote:\nVerification code 123456' }), []);
    assert.deepEqual(extractVerificationCodes({ text: 'Thanks\n-----原始邮件-----\n验证码 123456' }), []);
    assert.deepEqual(extractVerificationCodes({ subject: 'Re: Verification code: 123456', text: 'Thanks!' }), []);
    assert.deepEqual(extractVerificationCodes({ subject: 'Re: Verification code', snippet: 'Thanks! Old verification code: 123456' }), []);
    assert.deepEqual(extractVerificationCodes({ text: 'Thanks\nFrom: Sender\nSent: Tuesday\nSubject: Verification code\nVerification code 123456' }), []);
    assert.deepEqual(extractVerificationCodes({ text: '谢谢\n发件人：某人\n发送时间：今天\n主题：验证码\n验证码 123456' }), []);
  });

  test('an Outlook quote separator cuts its following siblings while retaining the new message', () => {
    assert.deepEqual(extractVerificationCodes({ html: '<div>验证码 009988<div id="divRplyFwdMsg">From: sender</div>'
      + '<p>Verification code 123456</p></div><p>Security code 654321</p>' }), ['009988']);
    assert.deepEqual(extractVerificationCodes({ html: '<div>Thanks<div id="divRplyFwdMsg">From: sender</div>'
      + '<p>Verification code 123456</p></div><p>Security code 654321</p>' }), []);
  });

  test('an HTML document incorrectly delivered in text still removes old and inert content', () => {
    assert.deepEqual(extractVerificationCodes({ text: '<div>Verification code 009988</div><blockquote>Verification code 123456</blockquote><script>verification code 777777</script>' }), ['009988']);
  });

  test('multiple distinct codes remain ambiguous and are deduplicated', () => {
    assert.deepEqual(extractVerificationCodes({ subject: 'Verification code: 001234', text: '验证码：001234\n安全代码：556677\n验证码：889900' }), ['001234', '556677', '889900']);
    assert.equal(extractVerificationCodes({ text: ['1111', '2222', '3333', '4444', '5555'].map(v => `验证码：${v}`).join('\n') }).length, 4);
    assert.deepEqual(extractVerificationCodes({ text: '验证码：123456 或 654321' }), ['123456', '654321']);
    assert.deepEqual(extractVerificationCodes({ text: 'Verification code: 123456 or 654321' }), ['123456', '654321']);
    assert.deepEqual(extractVerificationCodes({ text: 'Verification code: 123456, 654321. Expires in 1234 seconds.' }), ['123456', '654321']);
    assert.deepEqual(extractVerificationCodes({ text: '验证码：123456，订单编号：654321。' }), ['123456']);
  });

  test('ordinary numbers, order numbers and discount codes are not verification codes', () => {
    for (const text of [
      'Order number 123456. Phone 13800138000. Date 2026-11-06.',
      '订单号：123456，运单号：543210，联系电话：1234-5678。',
      'Discount code SAVE20',
      'Your coupon code is ABC123',
      'Security code expires in 1234 seconds.',
      '验证码过期时间：2026-11-06',
      'Your verification code is in https://example.test/123456',
      'OTP: 13800138000',
      '订单号123456 验证码请在另一封邮件中查找。',
      'Order number 123456 verification code will arrive separately.',
    ]) assert.deepEqual(extractVerificationCodes({ text }), [], text);
  });

  test('does not treat dates or telephone chunks under a verification subject as codes', () => {
    assert.deepEqual(extractVerificationCodes({ subject: 'Your verification code', text: '2026-11-06\n+1-202-555-1234\nOrder number: 123456' }), []);
  });

  test('a long truncated snippet cannot produce a partial code at its end', () => {
    assert.deepEqual(extractVerificationCodes({ snippet: `${'Hello '.repeat(31)}Verification code: 1234` }), []);
    assert.deepEqual(extractVerificationCodes({ snippet: 'Verification code: 001234.' }), ['001234']);
  });

  test('bounded input and malformed HTML do not throw or scan unbounded tails', () => {
    assert.deepEqual(extractVerificationCodes({ text: `${'x'.repeat(60_000)} 验证码：123456` }), []);
    assert.doesNotThrow(() => extractVerificationCodes({ html: '<'.repeat(60_000) }));
    assert.deepEqual(extractVerificationCodes({ subject: null, text: 123456, html: {} }), []);
    assert.deepEqual(extractVerificationCodes({ text: `${' '.repeat(47_978)}Verification code: 123456789000` }), []);
  });
});
