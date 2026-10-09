const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubif-distribution-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } }).trim();
}
function copyScript(dir, name) {
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', name), path.join(dir, 'scripts', name));
}
function run(dir, command, args) { return spawnSync(command, args, { cwd: dir, encoding: 'utf8' }); }

test('Git updater refuses edits, checks without fetching, and fast-forwards a local upstream', t => {
  const dir = fixture(t), source = path.join(dir, 'source'), clone = path.join(dir, 'clone');
  fs.mkdirSync(source); git(source, 'init', '-b', 'main');
  copyScript(source, 'update.cjs');
  fs.writeFileSync(path.join(source, 'version.txt'), 'one');
  git(source, 'add', '.'); git(source, 'commit', '-m', 'Initial fixture');
  git(dir, 'clone', source, clone);
  fs.writeFileSync(path.join(source, 'version.txt'), 'two');
  git(source, 'add', '.'); git(source, 'commit', '-m', 'Update fixture');
  let result = run(clone, process.execPath, ['scripts/update.cjs', '--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(clone, 'version.txt'), 'utf8'), 'one');
  fs.writeFileSync(path.join(clone, 'local.txt'), 'Keep this');
  result = run(clone, process.execPath, ['scripts/update.cjs']);
  assert.equal(result.status, 1); assert.match(result.stderr, /Local changes/);
  assert.equal(fs.readFileSync(path.join(clone, 'local.txt'), 'utf8'), 'Keep this');
  fs.unlinkSync(path.join(clone, 'local.txt'));
  result = run(clone, process.execPath, ['scripts/update.cjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(clone, 'version.txt'), 'utf8'), 'two');
  assert.match(result.stdout, /Reload UBIF/);
  // Local and upstream commits diverge: neither local commit nor file is discarded.
  fs.writeFileSync(path.join(clone, 'local.txt'), 'Local commit'); git(clone, 'add', '.'); git(clone, 'commit', '-m', 'Local');
  const before = git(clone, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(source, 'version.txt'), 'three'); git(source, 'add', '.'); git(source, 'commit', '-m', 'Remote');
  result = run(clone, process.execPath, ['scripts/update.cjs']);
  assert.equal(result.status, 1);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(path.join(clone, 'local.txt'), 'utf8'), 'Local commit');
});

test('packager produces a reproducible extension-only ZIP and requires release notes', t => {
  const dir = fixture(t); copyScript(dir, 'package.py');
  fs.mkdirSync(path.join(dir, 'extension'));
  fs.writeFileSync(path.join(dir, 'extension', 'manifest.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(dir, 'extension', 'app.js'), '// fixture');
  fs.writeFileSync(path.join(dir, 'extension', '.DS_Store'), 'excluded');
  fs.writeFileSync(path.join(dir, 'private-notes.txt'), 'excluded');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\nWork in progress.\n');
  let result = run(dir, 'python3', ['scripts/package.py', '--release']);
  assert.equal(result.status, 1); assert.match(result.stderr, /dated \[1.2.3\] entry/);
  fs.appendFileSync(path.join(dir, 'CHANGELOG.md'), '\n## [1.2.3] — 2026-10-09\n\n- Fixture release.\n\n## [1.2.2]\n\nOld release.\n');
  result = run(dir, 'python3', ['scripts/package.py', '--release']);
  assert.equal(result.status, 0, result.stderr);
  const zip = path.join(dir, 'dist', 'ubif-nextgen-plus-1.2.3.zip');
  const bytes = fs.readFileSync(zip);
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.match(fs.readFileSync(`${zip}.sha256`, 'utf8'), new RegExp(`^${digest}  `));
  const names = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', zip], { encoding: 'utf8' }));
  assert.deepEqual(names, ['app.js', 'manifest.json']);
  const notes = fs.readFileSync(path.join(dir, 'dist', 'release-notes.md'), 'utf8');
  assert.match(notes, /Fixture release/); assert.doesNotMatch(notes, /Old release|Work in progress/);
  result = run(dir, 'python3', ['scripts/package.py']);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(fs.readFileSync(zip), bytes);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.4' }));
  result = run(dir, 'python3', ['scripts/package.py']);
  assert.equal(result.status, 1); assert.match(result.stderr, /versions differ/);
});
