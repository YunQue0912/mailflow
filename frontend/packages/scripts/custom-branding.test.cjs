'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendRoot = path.join(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
const adminPanel = fs.readFileSync(path.join(frontendRoot, 'src', 'components', 'AdminPanel.jsx'), 'utf8');
const electronMain = fs.readFileSync(path.join(frontendRoot, 'packages', 'electron', 'main.cjs'), 'utf8');

test('user-facing project links belong to the custom distribution', () => {
  assert.equal(packageJson.homepage, 'https://github.com/YunQue0912/mailflow');
  assert.equal(packageJson.repository.url, 'git+https://github.com/YunQue0912/mailflow.git');
  assert.equal(packageJson.bugs.url, 'https://github.com/YunQue0912/mailflow/issues');

  for (const source of [adminPanel, electronMain]) {
    assert.doesNotMatch(source, /https:\/\/mailflow\.sh/);
    assert.doesNotMatch(source, /github\.com\/maathimself\/mailflow/);
    assert.doesNotMatch(source, /github\.com\/sponsors\/maathimself/);
    assert.doesNotMatch(source, /ko-fi\.com\/mailflow/);
  }
});
