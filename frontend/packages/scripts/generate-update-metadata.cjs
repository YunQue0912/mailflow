'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseCustomVersion, validateUpdateManifest } = require('../shared/custom-release.cjs');

const options = parseArgs(process.argv.slice(2));
const sourceDir = path.resolve(required('artifacts'));
const outputDir = path.resolve(required('output'));
const parsedVersion = parseCustomVersion(required('tag'));
const androidCertificateSha256 = normalizeFingerprint(required('android-certificate-sha256'));

if (!parsedVersion) throw new Error('The release tag must match vX.Y.Z-custom.N.');
if (!/^[A-F0-9]{64}$/.test(androidCertificateSha256)) {
  throw new Error('Android certificate SHA-256 must contain exactly 64 hexadecimal characters.');
}

const allFiles = listFiles(sourceDir);
const expectedNames = {
  windows: `MailFlow-${parsedVersion.versionName}-Setup.exe`,
  blockmap: `MailFlow-${parsedVersion.versionName}-Setup.exe.blockmap`,
  android: `MailFlow-${parsedVersion.versionName}.apk`,
  aab: `MailFlow-${parsedVersion.versionName}.aab`,
  latest: 'latest.yml',
};

const selected = Object.fromEntries(
  Object.entries(expectedNames).map(([key, name]) => [key, findUnique(allFiles, name)]),
);

fs.mkdirSync(outputDir, { recursive: true });
const copiedFiles = [];
for (const file of Object.values(selected)) {
  const target = path.join(outputDir, path.basename(file));
  fs.copyFileSync(file, target);
  copiedFiles.push(target);
}

for (const name of ['windows-verification.json', 'android-verification.json']) {
  const source = findUnique(allFiles, name);
  const target = path.join(outputDir, name);
  fs.copyFileSync(source, target);
  copiedFiles.push(target);
}

const windowsFile = path.join(outputDir, expectedNames.windows);
const androidFile = path.join(outputDir, expectedNames.android);
const publishedAt = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  channel: 'stable',
  tag: parsedVersion.tag,
  versionName: parsedVersion.versionName,
  publishedAt,
  releaseNotesUrl: `https://github.com/YunQue0912/mailflow/releases/tag/${parsedVersion.tag}`,
  windows: {
    arch: 'x64',
    signaturePolicy: 'unsigned',
    asset: expectedNames.windows,
    size: fs.statSync(windowsFile).size,
    sha256: sha256(windowsFile),
  },
  android: {
    packageName: 'sh.mailflow.app',
    versionCode: parsedVersion.versionCode,
    asset: expectedNames.android,
    size: fs.statSync(androidFile).size,
    sha256: sha256(androidFile),
    certificateSha256: androidCertificateSha256.toLowerCase(),
  },
};

if (!validateUpdateManifest(manifest)) throw new Error('Generated update manifest failed schema validation.');

const manifestPath = path.join(outputDir, 'update-manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const checksumEntries = [...copiedFiles, manifestPath]
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
  .map((file) => `${sha256(file)}  ${path.basename(file)}`);
fs.writeFileSync(path.join(outputDir, 'SHA256SUMS.txt'), `${checksumEntries.join('\n')}\n`);

console.log(`Prepared ${checksumEntries.length + 1} release assets in ${outputDir}.`);

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = String(args[index] || '').replace(/^--/, '');
    values[key] = args[index + 1];
  }
  return values;
}

function required(key) {
  const value = options[key];
  if (!value) throw new Error(`Missing required --${key} argument.`);
  return value;
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(file) : entry.isFile() ? [file] : [];
  });
}

function findUnique(files, name) {
  const matches = files.filter((file) => path.basename(file) === name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} artifact, found ${matches.length}.`);
  }
  return matches[0];
}

function normalizeFingerprint(value) {
  return String(value || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
