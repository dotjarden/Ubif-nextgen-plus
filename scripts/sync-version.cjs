/* npm version updates package.json and the lockfile; keep Chrome in step. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
if (!/^\d+\.\d+\.\d+$/.test(version) || version.split('.').some(n => Number(n) > 65535)) throw new Error('Use a three-part numeric Chrome version (no prerelease suffix).');
const file = path.join(root, 'extension/manifest.json');
const manifest = JSON.parse(fs.readFileSync(file));
manifest.version = version;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Chrome manifest version: ${version}`);
