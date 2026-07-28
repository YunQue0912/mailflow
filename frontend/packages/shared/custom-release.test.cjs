'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareCustomVersions,
  isNewerCustomVersion,
  isStableCustomRelease,
  parseCustomVersion,
  validateUpdateManifest,
} = require('./custom-release.cjs');

test('parses a custom release tag and calculates Android versionCode', () => {
  assert.deepEqual(parseCustomVersion('v2.7.1-custom.5'), {
    major: 2,
    minor: 7,
    patch: 1,
    custom: 5,
    tag: 'v2.7.1-custom.5',
    versionName: '2.7.1-custom.5',
    versionCode: 207010005,
  });
});

test('compares upstream and custom components in order', () => {
  assert.equal(isNewerCustomVersion('2.7.1-custom.5', '2.7.1-custom.4'), true);
  assert.equal(isNewerCustomVersion('2.7.2-custom.1', '2.7.1-custom.99'), true);
  assert.equal(isNewerCustomVersion('2.8.0-custom.1', '2.7.9-custom.999'), true);
  assert.equal(compareCustomVersions('2.7.1-custom.5', 'v2.7.1-custom.5'), 0);
  assert.equal(isNewerCustomVersion('2.7.1-custom.4', '2.7.1-custom.5'), false);
});

test('rejects malformed and out-of-range custom versions', () => {
  for (const value of [
    '2.7.1',
    'v2.7.1-custom',
    'v2.7.1-custom.1-beta',
    'v2.100.1-custom.1',
    'v2.7.100-custom.1',
    'v2.7.1-custom.10000',
    'v22.0.0-custom.1',
  ]) {
    assert.equal(parseCustomVersion(value), null, value);
  }
});

test('stable release selection rejects draft, prerelease, and invalid tags', () => {
  assert.equal(isStableCustomRelease({ tag_name: 'v2.7.1-custom.5', draft: false, prerelease: false }), true);
  assert.equal(isStableCustomRelease({ tag_name: 'v2.7.1-custom.5', draft: true, prerelease: false }), false);
  assert.equal(isStableCustomRelease({ tag_name: 'v2.7.1-custom.5', draft: false, prerelease: true }), false);
  assert.equal(isStableCustomRelease({ tag_name: 'v2.7.1', draft: false, prerelease: false }), false);
});

test('validates schema 1 stable update manifests', () => {
  const manifest = {
    schemaVersion: 1,
    channel: 'stable',
    tag: 'v2.7.1-custom.5',
    versionName: '2.7.1-custom.5',
    windows: {
      arch: 'x64',
      signaturePolicy: 'unsigned',
      asset: 'MailFlow-2.7.1-custom.5-Setup.exe',
      size: 123,
      sha256: 'a'.repeat(64),
    },
    android: {
      packageName: 'sh.mailflow.app',
      versionCode: 207010005,
      asset: 'MailFlow-2.7.1-custom.5.apk',
      size: 456,
      sha256: 'b'.repeat(64),
      certificateSha256: 'c'.repeat(64),
    },
  };

  assert.equal(validateUpdateManifest(manifest), true);
  assert.equal(validateUpdateManifest({ ...manifest, channel: 'beta' }), false);
  assert.equal(validateUpdateManifest({ ...manifest, versionName: '2.7.1-custom.4' }), false);
  assert.equal(validateUpdateManifest({
    ...manifest,
    windows: { ...manifest.windows, signaturePolicy: 'authenticode' },
  }), false);
  assert.equal(validateUpdateManifest({
    ...manifest,
    windows: { ...manifest.windows, asset: 'MailFlow-2.7.1-custom.6-Setup.exe' },
  }), false);
  assert.equal(validateUpdateManifest({
    ...manifest,
    android: { ...manifest.android, asset: 'MailFlow-2.7.1-custom.6.apk' },
  }), false);
});
