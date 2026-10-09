<div align="center">
  <img src="icon.svg" width="88" height="88" alt="UBIF NextGen Plus icon">
  <h1>UBIF NextGen Plus</h1>
  <p><strong>Less clicking. Faster lookups. A portal that works your way.</strong></p>
  <p>Universal search, barcode scanning, custom tables, a daily update board, and a movable support chat for the UBIF portal.</p>
  <p><a href="#install">Install</a> · <a href="#update">Update</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="https://github.com/dotjarden/Ubif-nextgen-plus/issues">Request a feature</a> · <a href="https://www.buymeacoffee.com/jarden">Buy me a coffee</a></p>
</div>

---

**Latest release: [0.8.3](https://github.com/dotjarden/Ubif-nextgen-plus/releases/tag/v0.8.3)** · [What changed](CHANGELOG.md#083--2026-10-09)

Built for Chrome and `portal.ubreakifix.net`. Runs inside your existing portal session, with no additional account or subscription. This is an independent extension, not an official UBIF or Asurion product.

## What you get

| Feature | What it does |
| --- | --- |
| **Universal search** | Search customers, work orders, items, claims, and inventory serials from the portal header. Press **Cmd/Ctrl + K** to start. |
| **Barcode scanning** | Open work orders, follow portal QR links, send other scans to search, and scan repeatedly during purchase-order receiving. |
| **Update Today** | See active work orders due today or earlier, read/add notes, schedule the next update, and prepare supported status changes. |
| **Custom columns** | Show, hide, reorder, and resize Workorders and Arrivals columns. Save a separate layout for each view. |
| **Support chat** | Move and minimize chat while keeping the portal usable; recover supported sessions and receive configurable unread alerts. |
| **Your preferences** | 30 controls across six feature categories, searchable settings, per-category resets, and a full-page settings view. |

Want the details? Read the [feature guide](docs/FEATURES.md), including keyboard controls, scanning rules, column behavior, and support-session limits.

## Install

### From Git

Install [Git](https://git-scm.com/downloads), then clone the project into a folder you intend to keep:

```sh
git clone https://github.com/dotjarden/Ubif-nextgen-plus.git
cd Ubif-nextgen-plus
```

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Choose **Load unpacked**, then select the repository's **extension** folder—not the repository root.
3. Refresh your portal tabs, then pin **UBIF NextGen Plus** from Chrome's Extensions menu.
4. Click the toolbar icon to configure the extension.

No build or npm install is needed to use the extension. Node.js is only needed for the optional update helper and development tools.

### Without Git

Download the repository using **Code → Download ZIP**, or download the extension ZIP from [the latest release](https://github.com/dotjarden/Ubif-nextgen-plus/releases/latest).

Extract it into a permanent folder and follow steps 1–4 above. Source downloads contain an `extension` subfolder; packaged release ZIPs put `manifest.json` directly in the extracted folder. Load the folder containing that file. Keep it in place—Chrome reads the extension from there.

## Update

### Git installation

From your existing checkout:

```sh
npm run update
```

Requires Node.js 20+ and Git; no `npm install` is needed. The helper checks for local edits and a tracking branch, then performs a fast-forward-only pull. It does not discard changes, create merge commits, or execute downloaded install scripts. Use `npm run update:check` for a local readiness check without fetching or updating.

Prefer plain Git? Run `git pull --ff-only` in that same folder.

**After either command:** reload the extension at `chrome://extensions`, then refresh your portal tabs. Finish any unsaved portal work before refreshing.

### ZIP installation

Download the newer ZIP, extract it, and replace the contents of the **same extension folder** you originally loaded. Then reload the extension and refresh the portal. Keep the same installation to retain its settings and saved column layouts; do not remove and reinstall it as an update step.

### Can it update automatically?

The current installation method is unpacked source: Git or ZIP updates the files, and Chrome must reload them. There is no automatic updater or Web Store listing configured here. Chrome Web Store distribution is the future path for browser-managed updates; GitHub Releases alone do not provide that behavior. See [Chrome's update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle).

Maintainers can create tested ZIPs and draft GitHub releases using the included [release workflow](docs/RELEASING.md).

## Make it yours

Open the toolbar popup and choose a category—or use **Find a setting**. **Open in tab** opens the same controls in a browser tab.

| Category | Available preferences |
| --- | --- |
| Home | Hide the Home calendar. |
| Universal search | Enable search; choose result categories, shortcut, typing delay, minimum characters, and opening results in new tabs. |
| Update Today | Enable the board; include tomorrow; configure periodic refresh, status dragging, and empty columns. |
| Barcode scanning | Enable scanning; choose navigation, search forwarding, receiving, OEM field focus, and automatic confirmation. |
| Table columns | Enable column customization for Workorders and Arrivals independently. Use **Columns** on each table for its layout. |
| Support chat | Enable enhancements; choose desktop notifications, unread badges, and message previews. |

Changes save immediately and apply to open portal tabs. Disabled child controls retain their values until the parent feature is enabled again. Category resets preserve unrelated preferences and column layouts. **Updates & help** explains how to update your installation and links to release notes.

A settings page served from `localhost` is a visual preview, not your installed extension's settings. Use the Chrome toolbar icon for changes that affect the portal.

## Privacy and permissions

- **Storage:** settings, column layouts, and support-window position stay in extension-local storage.
- **Notifications:** optional desktop alerts for hidden support messages. Disable previews if you prefer a generic notification.
- **Portal access:** content scripts run on `https://portal.ubreakifix.net/*` and use your current session. Search and table data use portal APIs; board saves perform actions you request.
- **Support recovery:** drafts and recovery state stay in the portal tab's session storage. Ended or expired support sessions cannot be revived.
- **No added analytics or telemetry:** the extension does not send portal data to a third-party service. Project and donation links open only when you click them.

For storage details, API behavior, and recovery boundaries, see [Scope and privacy](docs/FEATURES.md#scope-and-privacy).

## Troubleshooting

| Symptom | Try this |
| --- | --- |
| New features do not appear | Reload the extension, then refresh the portal tab. Confirm Chrome loaded the folder you updated. |
| A setting is grayed out | Enable its parent feature. Scan-to-search also requires universal search. |
| Scans act like typing | Enable scanning; use a keyboard-mode scanner ending in Enter or Tab; keep the portal tab active. Embedded frames are not supported. |
| Git update refuses to run | Commit or stash local changes. A detached checkout or branch without an upstream needs to be fixed before updating. The helper leaves your files alone. |
| Search returns no results | Check enabled categories, query length, and portal login. Inventory serial search is not a general IMEI lookup API. |
| Support does not reconnect | Confirm the portal session and support conversation are still active. File selections and uploads in progress are not restored. |

## Development and verification

Requires Node.js 20+, Git, and Python 3 (used by distribution tests and packaging).

```sh
npm ci
npm run check
npm test
npm run package
```

`npm run package` reruns checks/tests and writes a versioned extension ZIP and SHA-256 checksum to `dist/`. Only extension assets are included; source notes, demo data, and development dependencies stay out of the ZIP.

For the fictional-data portal preview:

```sh
node demo/server.cjs
```

Open `http://127.0.0.1:8765`. Automated tests cover settings persistence, live toggles, search, scan routing, tables, board behavior, and support recovery. Tests use simulated browser and portal behavior: physical scanner timing, live board writes, and live support reconnection still need checks in the authenticated portal. Portal markup changes may require an adapter update.

## Feedback and support

[**Request a feature or report a bug**](https://github.com/dotjarden/Ubif-nextgen-plus/issues) with the extension version, affected portal page, what you expected, and steps to reproduce. Redact customer details, serials, credentials, and chat transcripts from examples.

If the extension saves you time, [**buy me a coffee**](https://www.buymeacoffee.com/jarden). Contributions are optional; all features remain available.
