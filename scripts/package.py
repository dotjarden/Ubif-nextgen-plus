#!/usr/bin/env python3
"""Build an installable ZIP from extension files only, plus a checksum."""
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent

def build(root=ROOT, release=False):
    extension = root / 'extension'
    manifest = json.loads((extension / 'manifest.json').read_text())
    version = manifest['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Manifest must use a three-part numeric version.')
    package = json.loads((root / 'package.json').read_text())
    lock = json.loads((root / 'package-lock.json').read_text())
    if any(v != version for v in [package['version'], lock['version'], lock['packages']['']['version']]):
        raise ValueError('Package, lockfile, and manifest versions differ. Run npm run version to sync the manifest after npm version.')
    changelog = (root / 'CHANGELOG.md').read_text()
    notes = re.search(r'^## \[' + re.escape(version) + r'\][^\n]*\n(.*?)(?=^## |\Z)', changelog, re.M | re.S)
    if release:
        heading = re.search(r'^## \[' + re.escape(version) + r'\] (?:—|-) (\d{4}-\d{2}-\d{2})$', changelog, re.M)
        if not notes or not heading:
            raise ValueError(f'Add a dated [{version}] entry to CHANGELOG.md before creating a release tag.')
        date.fromisoformat(heading.group(1))
    files = sorted(p for p in extension.rglob('*') if p.is_file() and not any(part.startswith('.') for part in p.relative_to(extension).parts))
    for file in files:
        if file.is_symlink() or any(parent.is_symlink() for parent in file.parents if parent != root):
            raise ValueError(f'Symlinks are not allowed in the extension package: {file.name}')
        if file.suffix not in {'.js', '.json', '.html', '.css', '.png', '.svg'}:
            raise ValueError(f'Unexpected extension file: {file.name}')
    output = root / 'dist'
    output.mkdir(exist_ok=True)
    archive = output / f'ubif-nextgen-plus-{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as target:
        for file in files:
            info = zipfile.ZipInfo(file.relative_to(extension).as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            target.writestr(info, file.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n')
    if release:
        (output / 'release-notes.md').write_text(notes.group(1).strip() + '\n\nInstall and update instructions: see the repository README.\n')
    return archive

if __name__ == '__main__':
    try:
        if any(arg != '--release' for arg in sys.argv[1:]):
            raise ValueError('Usage: python3 scripts/package.py [--release]')
        print(build(release='--release' in sys.argv[1:]))
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))
