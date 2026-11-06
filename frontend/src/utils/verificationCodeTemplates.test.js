import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractVerificationCodes, extractReliableVerificationCodes } from './verificationCodes.js';

// Synthetic examples only; no real mailbox addresses or sign-in codes.
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;

const templates = [
  {
    name: 'Microsoft-style Chinese security-code mail excludes its postal footer',
    input: {
      subject: 'Microsoft 帐户安全代码',
      html: '<h3>Microsoft 帐户</h3><h1>安全代码</h1>'
        + '<p>请对个人 Microsoft 帐户 ab**1@example.test 使用以下安全代码。</p>'
        + '<p>安全代码：<b>046281</b></p><p>谢谢！Microsoft 帐户团队</p>'
        + '<p>Microsoft Corporation, One Microsoft Way, Redmond, WA 98052</p>',
    },
    codes: ['046281'], reliable: ['046281'],
  },
  {
    name: 'Microsoft-style English security-code mail',
    input: {
      subject: 'Microsoft account security code',
      html: '<h1>Security code</h1><p>Please use the following security code for your account.</p>'
        + '<p>Security code: <strong>083147</strong></p><p>Redmond, WA 98052</p>',
    },
    codes: ['083147'], reliable: ['083147'],
  },
  {
    name: 'English sign-in instruction without a verification-code label',
    input: { subject: 'Sign in to your account', text: 'Enter 046281 to finish signing in. This expires in 10 minutes.' },
    codes: ['046281'], reliable: ['046281'],
  },
  {
    name: 'Chinese identity confirmation with a separate numeric block',
    input: {
      subject: '确认是您本人',
      html: '<p>请在登录页面输入以下数字以确认您的身份。</p>'
        + '<div style="font-size:28px;letter-spacing:4px">083147</div><p>请在 10 分钟内使用。</p>',
    },
    codes: ['083147'], reliable: ['083147'],
  },
  {
    name: 'generic branded code with a sign-in purpose',
    input: { subject: 'Your Example code', text: 'Your code is 048126. Use it to finish signing in. It expires in 10 minutes.' },
    codes: ['048126'], reliable: ['048126'],
  },
  {
    name: 'one-time PIN is a verification challenge',
    input: { subject: 'Confirm your sign-in', text: 'Your one-time PIN is 004782. Enter it in the app to continue signing in.' },
    codes: ['004782'], reliable: ['004782'],
  },
  {
    name: 'identity context and typography alone remain a manual suggestion',
    input: { subject: 'Confirm it is you', html: '<p>Sign in to your account.</p><h2>046281</h2>' },
    codes: ['046281'], reliable: [],
  },
  {
    name: 'security news does not make prominent statistics a code',
    input: { subject: 'Security newsletter', html: '<h2>2026</h2><p>Our annual report covers 123456 accounts.</p><strong>987654</strong>' },
    codes: [], reliable: [],
  },
  {
    name: 'order confirmation and coupons stay ordinary mail',
    input: { subject: 'Confirm your order', html: '<p>Order number: 098765</p><h2>SAVE20</h2><p>Use this coupon on your next purchase.</p>' },
    codes: [], reliable: [],
  },
  {
    name: 'a sign-in alert with an address and case number is not a challenge',
    input: { subject: 'New sign-in activity', text: 'We noticed a new sign-in from IP address 203.0.113.18. Case number: 192837. If this was you, no action is needed.' },
    codes: [], reliable: [],
  },
  {
    name: 'a login notification support reference is not a one-time code',
    input: { subject: 'New login attempt', text: 'Your account was accessed. If you contact support, use reference 123456.' },
    codes: [], reliable: [],
  },
  {
    name: 'a support reference after the digits is still metadata',
    input: { subject: 'Sign in to your account', text: 'We sent you a link. To contact support, use 123456 as your reference.' },
    codes: [], reliable: [],
  },
  {
    name: 'a permanent account number used to sign in is not a verification challenge',
    input: { subject: 'Welcome - sign in to your account', text: 'Account number: 123456. Use this number to sign in.' },
    codes: [], reliable: [],
  },
  {
    name: 'a user ID used to sign in is not a verification challenge',
    input: { subject: 'New login attempt', text: 'User ID: 654321. Use this ID to sign in to your account.' },
    codes: [], reliable: [],
  },
];

for (const fixture of templates) {
  test(fixture.name, () => {
    assert.deepEqual(extractVerificationCodes(fixture.input), fixture.codes);
    assert.deepEqual(extractReliableVerificationCodes(fixture.input), fixture.reliable);
  });
}
