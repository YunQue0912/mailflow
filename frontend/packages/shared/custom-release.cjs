'use strict';

const CUSTOM_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)-custom\.(\d+)$/;
const ANDROID_MAX_VERSION_CODE = 2100000000;

function parseCustomVersion(value) {
  const input = String(value || '').trim();
  const match = CUSTOM_TAG_PATTERN.exec(input);
  if (!match) return null;

  const [major, minor, patch, custom] = match.slice(1).map(Number);
  if (![major, minor, patch, custom].every(Number.isSafeInteger)) return null;
  if (minor >= 100 || patch >= 100 || custom >= 10000) return null;

  const versionCode = (major * 100000000) + (minor * 1000000) + (patch * 10000) + custom;
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0 || versionCode > ANDROID_MAX_VERSION_CODE) {
    return null;
  }

  const versionName = `${major}.${minor}.${patch}-custom.${custom}`;
  return {
    major,
    minor,
    patch,
    custom,
    tag: `v${versionName}`,
    versionName,
    versionCode,
  };
}

function compareCustomVersions(left, right) {
  const a = parseCustomVersion(left);
  const b = parseCustomVersion(right);
  if (!a || !b) return null;

  for (const key of ['major', 'minor', 'patch', 'custom']) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return 0;
}

function isNewerCustomVersion(candidate, current) {
  return compareCustomVersions(candidate, current) === 1;
}

function isStableCustomRelease(release) {
  return Boolean(
    release
    && release.draft !== true
    && release.prerelease !== true
    && parseCustomVersion(release.tag_name),
  );
}

function validateUpdateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.channel !== 'stable') return false;
  const parsed = parseCustomVersion(manifest.tag);
  if (!parsed || manifest.versionName !== parsed.versionName) return false;

  const windows = manifest.windows;
  const android = manifest.android;
  return Boolean(
    windows
    && windows.arch === 'x64'
    && windows.signaturePolicy === 'unsigned'
    && windows.asset === `MailFlow-${parsed.versionName}-Setup.exe`
    && Number.isInteger(windows.size)
    && windows.size > 0
    && /^[a-f0-9]{64}$/i.test(windows.sha256 || '')
    && android
    && android.packageName === 'sh.mailflow.app'
    && android.versionCode === parsed.versionCode
    && android.asset === `MailFlow-${parsed.versionName}.apk`
    && Number.isInteger(android.size)
    && android.size > 0
    && /^[a-f0-9]{64}$/i.test(android.sha256 || '')
    && /^[a-f0-9]{64}$/i.test(android.certificateSha256 || ''),
  );
}

module.exports = {
  ANDROID_MAX_VERSION_CODE,
  compareCustomVersions,
  isNewerCustomVersion,
  isStableCustomRelease,
  parseCustomVersion,
  validateUpdateManifest,
};
