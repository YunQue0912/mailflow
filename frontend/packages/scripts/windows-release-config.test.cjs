'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

test('keeps Windows packaging explicitly unsigned', () => {
  assert.equal(packageJson.build?.win?.forceCodeSigning, false);
  assert.equal(packageJson.build?.win?.verifyUpdateCodeSignature, false);
  assert.equal(packageJson.scripts?.['app:windows-publisher'], undefined);
});

test('does not inject a Windows publisher into app-update.yml', () => {
  const githubPublisher = packageJson.build?.publish?.find(
    (entry) => entry?.provider === 'github' && entry.owner === 'YunQue0912' && entry.repo === 'mailflow',
  );
  assert.ok(githubPublisher);
  assert.equal(githubPublisher.publisherName, undefined);
});
