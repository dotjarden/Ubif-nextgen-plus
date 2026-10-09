# Releases and updates

## Local development

Load `extension/` once through Chrome's **Load unpacked** action. Keep that folder and installation across updates. After a source change, reload the extension at `chrome://extensions`, then refresh portal tabs. An unpacked installation cannot silently update itself from GitHub.

`npm run update` updates a clean checkout from its configured upstream with `git pull --ff-only`. It refuses local edits and missing tracking branches. It does not stash, reset, switch branches, or run dependency scripts. `npm run update:check` checks local readiness only; it does not tell you whether the remote has a newer version. Contributors should review and manage their own branches normally.

## Prepare a release

1. Run `npm ci`, then `npm run check` and `npm test`.
2. Verify changed workflows in the live portal where needed. Record limitations in the release notes.
3. Choose the next numeric version:

   ```sh
   npm version patch --no-git-tag-version
   ```

   Use `minor` or an explicit version when appropriate. The npm `version` hook synchronizes `extension/manifest.json`; package.json and package-lock.json are updated by npm. Chrome versions cannot contain prerelease suffixes.

4. Move completed items from **Unreleased** in `CHANGELOG.md` under `## [X.Y.Z] — YYYY-MM-DD`. Keep a fresh Unreleased heading for later work. Remove the working-version caveat from the released entry.
5. Run `npm run package`. Inspect `dist/ubif-nextgen-plus-X.Y.Z.zip` and its `.zip.sha256` file. The ZIP contains `manifest.json` at its root, so it is suitable for extraction and Load unpacked, or a future Web Store upload.
6. Commit the release changes, push the branch, and create/push the matching tag when ready:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   Replace `X.Y.Z` with the real version. Do not tag an uncommitted working tree.

## What GitHub Actions does

The workflow checks syntax, runs tests, builds the ZIP, and uploads build artifacts on pushes, pull requests, and manual runs. Tag pushes matching `v*` additionally check that the tag matches the manifest and that the changelog has a matching version section. They create a **draft** GitHub release containing that section's notes, the ZIP, and its checksum.

Review the draft and publish it in GitHub when ready. CI does not publish a release automatically or upload to the Chrome Web Store. Nothing is uploaded until these files are committed and pushed to GitHub with Actions enabled. The workflow uses GitHub's repository token; no additional release secret is required. If a tag already has a release, the release-creation step fails rather than overwriting it.

## Automatic browser updates later

For ordinary Chrome users on macOS and Windows, publish through the Chrome Web Store to use Chrome-managed updates. That requires a developer account, a listing, and store review; this repository does not configure that distribution. GitHub ZIPs are manual installation artifacts, not a browser update service.

References: [Chrome distribution](https://developer.chrome.com/docs/extensions/how-to/distribute), [extension update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle).
