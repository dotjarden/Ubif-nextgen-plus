# UBIF NextGen Plus

Chrome Manifest V3 extension for `https://portal.ubreakifix.net`.

## Scan purchase-order receiving labels without clicking

On `/boh/inventory/purchase-orders/<order>/receive`, scan part labels repeatedly with a keyboard-mode scanner ending in **Enter** or **Tab**. You do not need to click the scan area between labels. The portal tab must be active.

Rapid scans are delivered to the portal's existing `scanDetected` handler. The portal retains its serial matching, duplicate checks, access checks, OEM/IMEI prompts, and **Receive Parts** confirmation. Scans on this page never navigate to work orders. When the **Scan OEM Serial** popup opens, its input receives focus automatically. Scan the OEM serial and press **Enter** (or use the scanner’s Enter/Tab suffix) to validate it and activate the portal’s enabled **Confirm** button. Invalid serials stay in the popup for correction. Other dialogs keep their native scanning behavior; ordinary typing is unchanged. If a scan lands in an input or textarea, the previous value and selection are restored.

The adapter targets the observed `po-receive-container` markup and `scanDetected` event contract from the portal's public frontend code. Automated tests cover repeated scans, Enter/Tab, field restoration, dialog/loading guards, OEM focus and confirmation, invalid OEM serials, and route changes. A physical scanner check on the live receiving page is still needed.

## Scan to open a work order

Scan a work-order barcode on portal pages outside purchase-order receiving to open that work order in the same tab. No search-field focus is required. Supports a plain 5–10 digit work-order number (for example `30787644`), a full `https://portal.ubreakifix.net/repair/workorder/30787644` URL, the same URL without `https://`, or `/repair/workorder/30787644`.

Use a keyboard-mode barcode scanner configured to end each scan with **Enter** or **Tab**. Detection requires a rapid burst (at most 80 ms between keys and a 40 ms average including the terminator). Ordinary typing retains its normal behavior. When scanning into an input or textarea, its previous value and selection are restored before navigation. Unknown barcode formats, external URLs, and longer bare numbers such as IMEIs do not trigger navigation. Outside purchase-order receiving, other barcode types still use the portal's existing workflows. Scanning inside an embedded frame is not supported.

Reload the extension and the portal to activate version **0.4.2**. Scanner routing is covered by automated tests; physical scanner timing still needs verification with your scanner.

## Universal search

The portal header now contains an always-visible **Search everything…** field on every page. Type once to search Customers, Work orders, Items, Claims (including upcoming arrivals), and inventory Serial numbers. Results are grouped with direct links; there are no category tabs to select. Cmd/Ctrl+K focuses search, Enter searches immediately, arrows move through results, and Escape dismisses them.

Search waits 350 ms after typing, cancels superseded requests, and keeps successful categories visible if another fails. Queries and results are held in memory only. It uses the same portal endpoints and input rules observed in R92.4: 3 characters for customers/items, 5 digits for workorders, 6 characters for claims, and the inventory serial pattern such as `I-1234567890` or `123456-1234567890`. Serial results link to their inventory product. This preserves the portal's existing inventory-serial coverage; it does not add a new device IMEI endpoint.

Appointment and Arrival results retain a plain type label. A unique customer match also loads their arrivals, matching regular portal search.

Authenticated customer, item, claim/workorder, and arrival endpoint response shapes were verified in Search.app. Automated tests use representative fixtures. The updated extension still needs reloading in the browser; its full live UI and serial results have not been verified.

## Workorder and Arrivals columns

Arrivals rows size to their content without shrinking, preserve native avatar dimensions, and use wider default customer/device columns. The Columns control stays beside Add new.

- Hover a table header to reveal its grip; drag it onto another header to reorder. Drag a header’s right edge to resize (100–600 px).
- Keyboard: Tab to a header grip or resize separator, then use Left/Right arrows.
- Open **Columns** beside **Device type** on Workorders or **Add new** on Arrivals. Every change applies immediately and is saved; the footer shows `shown of total` and the save state. **Done** closes the dialog — there is no Apply step.
- Every Workorders tab and the Arrivals page has its own saved visibility, order, and widths. **Apply to all tabs** copies the current layout to the other tabs.

### One catalog, no duplicates

Each column has a single logical id. When the portal’s own table renders a column — Device/Issue, Status, Program, Location, Total, Created, Last/Next update, Customer, WO # — that column appears in the dialog once, marked with a **table** badge and shown by default. When the current tab does not render it, the same column is offered as a data column (unchecked by default) filled from workorder data. A portal default such as **Device/Issue** or **Location** is therefore selectable on every tab, and a column never shows up twice.

Columns are grouped in the dialog as **Workorder**, **Program**, **Customer**, and **Device** (plus **Table** for headers this catalog does not recognise). Search filters the list, and the presets — *Portal only*, *Contact*, *Ops board*, *Everything* — apply live; the active preset stays highlighted. Presets never hide a column the table renders itself.

### Data columns

Extra columns (Status, Service outcome, Location, Total, Phone with contact permission flags, Email, Serial/IMEI, Passcode set — shown as `Set`/`—`, never the code, Issues, Items with device, and so on) are read from the portal’s own `POST /api/workorders` responses. `extension/page.js` runs in the page world, observes those responses and forwards the records to the content script; it never fabricates data. Clicking an extra header’s sort button sorts the rows on screen; clicking a portal header re-sorts through the portal and clears our order.

The extension keeps the portal’s existing cells and event handlers. Reordering and column visibility use CSS placement so React still owns the original DOM, sorting and links remain attached to the original fields, and extra cells are only appended in rows whose cell count matches the header so the portal’s `nth-child` styling stays valid. Screen-reader and keyboard traversal of the table still follows source order, which can differ from visual order.

### Appearance

The dialog and injected cells use the portal’s own `--aui-*` design tokens (Apercu, 16 px dialog radius, pill buttons, `--aui-primary`, `--aui-scrim-overlay`), so it follows the portal’s light/dark theme automatically and looks native in both.

## Install or update

1. Open Chrome’s extension manager (`chrome://extensions`).
2. Enable Developer mode, choose **Load unpacked**, and select the `extension` folder in this project.
3. Reload the portal. Open Workorders or Arrivals.

After a source change, reload the extension in the extension manager, then reload the portal page. Search’s unpacked-extension support is browser-specific; the packaged target is Chrome.

No build step or runtime dependencies. All seven files in `extension/` are needed (`scanner.js`, `manifest.json`, `model.js`, `content.js`, `page.js`, `search-model.js`, `search.js`).

## Scope and privacy

The content script loads on this portal host to handle client-side navigation from other portal pages, with universal search active wherever the portal header is present. Column enhancements activate only on `/repair/workorders` and `/check-in/arrivals`. The only permission requested is `storage`.

- Column ids, visibility, order, widths, and sort are saved in extension-local storage under `ubif-plus.columns.v1.*`.
- `page.js` only *reads responses the portal already made* (`POST /api/workorders`) and forwards them to the content script with `postMessage`. It does not send data anywhere.
- If a response is missed (for example the content script loaded late), the content script may re-issue the portal’s **own last captured request body once**, unchanged, to fill the visible cells. No new queries, no other endpoints, no credentials or customer data leave the page.
- Universal search sends read-only queries to the portal’s same-origin `/api/customers`, `/api/workorders` (POST lookup), `/api/repair/available-parts`, `/api/arrivals/upcoming-arrivals`, `/api/customers/<id>/arrivals` for a unique customer match, and `/api/boh/inventory/<serial>` endpoints using the existing session. Search results do not overwrite the column data feed.
- No analytics, no telemetry, no third-party requests.

Only columns this catalog knows are offered as data columns; the adapter reads the observed `table > thead > tr > th[data-column-id]` structure for the portal-rendered set, and unknown headers still appear (grouped under **Table**) without invented fields. Portal markup changes may require an adapter update.

Implementation references: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Verification

```sh
npm ci
npm test
npm run check
node demo/server.cjs
```

Open `http://127.0.0.1:8765` for a preview using fictional records and the same extension files. The preview uses localStorage to simulate extension storage; production uses `chrome.storage.local`.

The suite covers the column catalog and grouping, live apply and persistence, per-tab layouts across table replacements, reloads and SPA route changes, reset/show-all, last-column guard, layout migration from pre-logical-id saves, write failure feedback, external preference changes, unrelated tables, content-script reinjection, header drag versus portal sorting, native filter placement (including nested dropdown wrappers), Arrivals independence, data columns (opt-in, formatting, placeholders, colspan rows, sorting), presets, search, and the `page.js` feed.

Checked manually against the authenticated portal: every Workorders tab lists all 24 columns exactly once with the portal defaults tagged **table**, data columns fill from real workorder responses, and the dialog renders correctly in both `asurion-light` and `asurion-dark`.
