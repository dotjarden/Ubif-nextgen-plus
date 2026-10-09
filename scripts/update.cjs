#!/usr/bin/env node
/* Update an existing checkout without overwriting edits or merging branches. */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function update(checkOnly = false) {
  const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD');
  if (git('status', '--porcelain')) throw new Error('Local changes found. Commit or stash them before updating; nothing was changed.');
  let upstream;
  try { upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'); }
  catch { throw new Error(`Branch ${branch} has no upstream. Set its tracking branch before updating.`); }
  if (checkOnly) { console.log(`Ready to update ${branch} from ${upstream}. No fetch or pull performed.`); return; }
  console.log(`Updating ${branch} from ${upstream}…`);
  execFileSync('git', ['pull', '--ff-only'], { cwd: root, stdio: 'inherit' });
  console.log('Source is up to date. Reload UBIF NextGen Plus at chrome://extensions, then refresh your portal tabs. Keep this folder and extension installation to retain settings.');
}
if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/update.cjs [--check]');
    update(process.argv.includes('--check'));
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  }
}
