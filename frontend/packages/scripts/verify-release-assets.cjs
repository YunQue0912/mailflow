'use strict';

const fs = require('fs');
const path = require('path');

const localDir = path.resolve(process.argv[2] || 'release-assets');
const remoteJson = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const remoteAssets = Array.isArray(remoteJson) ? remoteJson : remoteJson.assets;
if (!Array.isArray(remoteAssets)) throw new Error('GitHub Release response did not contain an asset list.');

const local = fs.readdirSync(localDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => ({ name: entry.name, size: fs.statSync(path.join(localDir, entry.name)).size }))
  .sort((a, b) => a.name.localeCompare(b.name));
const remote = remoteAssets
  .map((asset) => ({ name: asset.name, size: asset.size }))
  .sort((a, b) => a.name.localeCompare(b.name));

if (JSON.stringify(local) !== JSON.stringify(remote)) {
  throw new Error(`Release assets differ from local artifacts.\nLocal: ${JSON.stringify(local)}\nRemote: ${JSON.stringify(remote)}`);
}

console.log(`Verified ${local.length} GitHub Release assets by name and size.`);
