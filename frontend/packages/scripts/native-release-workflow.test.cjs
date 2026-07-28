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

test('parses and validates the Android signing certificate across apksigner versions', () => {
  assert.match(workflow, /grep -im1 'certificate SHA-256 digest:'/);
  assert.match(workflow, /\$\{#ACTUAL_CERTIFICATE\} -eq 64/);
  assert.match(workflow, /"\$ACTUAL_CERTIFICATE" == "\$EXPECTED_NORMALIZED"/);
});
