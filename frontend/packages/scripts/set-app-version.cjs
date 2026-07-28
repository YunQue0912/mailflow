const fs = require('fs');
const path = require('path');
const { parseCustomVersion } = require('../shared/custom-release.cjs');

const root = path.join(__dirname, '..', '..');
const requestedVersion = process.argv[2] || process.env.APP_VERSION || process.env.GITHUB_REF_NAME;

function updateJsonVersion(filePath, version) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  json.version = version;
  if (json.packages && json.packages['']) {
    json.packages[''].version = version;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

const parsedVersion = parseCustomVersion(String(requestedVersion || '').replace(/^refs\/tags\//, ''));
if (!parsedVersion) {
  if (requestedVersion) {
    console.error(`Invalid custom release tag "${requestedVersion}". Expected vX.Y.Z-custom.N within Android versionCode limits.`);
    process.exit(1);
  }

  console.log('No release tag version detected; keeping package versions unchanged.');
  process.exit(0);
}

const { versionName: version, versionCode } = parsedVersion;

updateJsonVersion(path.join(root, 'package.json'), version);
updateJsonVersion(path.join(root, 'package-lock.json'), version);

const buildGradlePath = path.join(root, 'packages', 'android', 'app', 'build.gradle');
let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
buildGradle = buildGradle.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);

buildGradle = buildGradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);

fs.writeFileSync(buildGradlePath, buildGradle);

console.log(`Prepared app package version ${version} (${versionCode}).`);
