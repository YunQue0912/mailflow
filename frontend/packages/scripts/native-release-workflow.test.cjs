'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'publish-apps.yml'),
  'utf8',
);

test('runs the Android Gradle wrapper without relying on executable file mode', () => {
  assert.match(workflow, /bash \.\/gradlew test lint assembleRelease bundleRelease/);
  assert.doesNotMatch(workflow, /^\s+\.\/gradlew test lint assembleRelease bundleRelease$/m);
});

test('rejects Windows packages containing Android dependencies or unsafe paths', () => {
  assert.match(workflow, /Windows package must not contain Android\/Gradle dependencies/);
  assert.match(workflow, /unsafe for legacy NSIS uninstallers/);
});

test('parses and validates the Android signing certificate across apksigner versions', () => {
  assert.match(workflow, /grep -im1 'certificate SHA-256 digest:'/);
  assert.ok(workflow.includes("sed 's/^.*: //'"));
  assert.match(workflow, /\$\{#ACTUAL_CERTIFICATE\} -eq 64/);
  assert.match(workflow, /"\$ACTUAL_CERTIFICATE" == "\$EXPECTED_NORMALIZED"/);
});

test('uploads and publishes draft Release assets by immutable Release ID', () => {
  assert.doesNotMatch(workflow, /gh release upload/);
  assert.match(workflow, /releases\/\$release_id\/assets\?per_page=100/);
  assert.match(workflow, /uploads\.github\.com\/repos\/\$\{GITHUB_REPOSITORY\}\/releases\/\$\{release_id\}\/assets/);
  assert.match(workflow, /--method PATCH "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/\$release_id"/);
});
