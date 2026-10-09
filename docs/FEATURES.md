# Feature guide

[← Back to the README](../README.md) · [Changelog](../CHANGELOG.md)

Detailed behavior and limitations for UBIF NextGen Plus.

## Settings

Click the extension's toolbar icon for settings, then use the category navigation or **Find a setting** to locate a control. **Open in tab** opens the same controls in a browser tab; Chrome's extension **Options** opens that page too. Settings save immediately and apply to open portal tabs. Related controls are disabled when their parent feature is off, and each category has its own reset button. A failed save restores the previous value and displays an error.

- **Home**: hide the Home calendar to give Quick actions and Today's to-do's more room.
- **Universal search**: enable search, configure the shortcut, delay (100–2,000 ms) and minimum query length (3–10), choose each of the five result categories, and open results in new tabs. Disabled categories make no search requests. Work orders still require at least 5 digits and claims at least 6 characters.
- **Update Today**: enable the board, include tomorrow by default, toggle periodic refresh and set its interval (15–600 seconds), allow status drag and drop, and show or hide empty status columns. Opening or returning to the board still refreshes it with periodic refresh off.
- **Barcode scanning**: enable scanning, independently control opening work orders/portal links and forwarding other scans to search, enable purchase-order receiving, and choose automatic OEM field focus and confirmation. Turning confirmation off leaves valid serials for manual review.
- **Table columns**: enable custom columns separately for Workorders and Arrivals. Manage visible columns, order, widths, presets, and layout resets with **Columns** on the relevant portal table, where the current tab's data is available.
- **Support chat**: enable the movable/minimizable support window, desktop notifications, unread badges, and notification message previews separately. Disable previews for a generic new-message notification.

Existing preferences are preserved. New settings retain the previous behavior by default; opening search results in a new tab is off by default. Category resets only restore that category's preferences, leaving saved column layouts intact. **Feature request** and **Buy me a coffee** open in new tabs.

Settings live in one extension-local storage record (`ubif-plus.settings.v1`) shared by the popup and full settings page. No new permissions are required for the settings page.

## Update Today board (0.5.0)

Open **Workorders → Update Today**, beside **Ready for pickup**, for active orders due today or earlier. Select **Include tomorrow** to expand the queue.

- Change the next update date/time without changing WO status. Use **In 2 days** or enter a parts arrival date.
- Drag to **Need to order**, **Awaiting item**, **Awaiting callback**, or **Ready for work**, then save with a date and note. Other transitions use the full Portal workflow.
- Read and add Portal notes. The board refreshes every minute while visible and on focus.

Dates use the displayed browser timezone. Orders without update dates are excluded. The picker has no three-day limit, but Portal validates saves. Failed or partial saves are reported; stale orders must be refreshed before saving.

Tests and local preview pass. Live Portal writes still need verification.

## Scan purchase-order receiving labels without clicking

On `/boh/inventory/purchase-orders/<order>/receive`, scan part labels repeatedly with a keyboard-mode scanner ending in **Enter** or **Tab**. You do not need to click the scan area between labels. The portal tab must be active.

Rapid scans are delivered to the portal's existing `scanDetected` handler. The portal retains its serial matching, duplicate checks, access checks, OEM/IMEI prompts, and **Receive Parts** confirmation. Scans on this page never navigate to work orders. When the **Scan OEM Serial** popup opens, its input receives focus automatically. Scan the OEM serial and press **Enter** (or use the scanner’s Enter/Tab suffix) to validate it and activate the portal’s enabled **Confirm** button. Invalid serials stay in the popup for correction. Other dialogs keep their native scanning behavior; ordinary typing is unchanged. If a scan lands in an input or textarea, the previous value and selection are restored.

The adapter targets the observed `po-receive-container` markup and `scanDetected` event contract from the portal's public frontend code. Automated tests cover repeated scans, Enter/Tab, field restoration, dialog/loading guards, OEM focus and confirmation, invalid OEM serials, and route changes. A physical scanner check on the live receiving page is still needed.

## Scan to open a work order, or search anything else (0.7.0)

Scan a work-order barcode on portal pages outside purchase-order receiving to open that work order in the same tab. No search-field focus is required. Supports a plain 5–10 digit work-order number (for example `30787644`), a full `https://portal.ubreakifix.net/repair/workorder/30787644` URL, the same URL without `https://`, or `/repair/workorder/30787644`.

Every other rapid scan is routed instead of dropped: an item barcode, an IMEI or serial number, a phone number, a claim reference or a name is handed to universal search, which opens with that value already typed and its results panel showing; the scanner's **Enter** is consumed so the panel stays open. A portal QR code for any other route — an item, a purchase order, a customer — opens that route. External links, prose-like text, very short values and ordinary typing are left alone, and with Universal search or Barcode scanning switched off a scan behaves like ordinary keystrokes again.

Use a keyboard-mode barcode scanner configured to end each scan with **Enter** or **Tab**. Detection requires a rapid burst (at most 80 ms between keys and a 40 ms average including the terminator). Ordinary typing retains its normal behavior. When scanning into an input or textarea, its previous value and selection are restored before navigation or search. Outside purchase-order receiving, other barcode types still use the portal's existing workflows. Scanning inside an embedded frame is not supported.

Reload the extension and the portal after updating. Scanner routing is covered by automated tests; physical scanner timing still needs verification with your scanner.

## Universal search

The portal header contains an always-visible **Search everything…** field on every page (when the portal collapses its own search box at narrow widths, the field parks in the visible header instead, so a scanned query and its results are always on screen). Type once to search Customers, Work orders, Items, Claims (including upcoming arrivals), and inventory Serial numbers. Results are grouped with direct links; there are no category tabs to select. Cmd/Ctrl+K focuses search, Enter searches immediately, arrows move through results, and Escape dismisses them. A barcode scan fills this field too — see [scanning](#scan-to-open-a-work-order-or-search-anything-else-070).

Search waits 350 ms after typing, cancels superseded requests, and keeps successful categories visible if another fails. Queries and results are held in memory only. It uses the same portal endpoints and input rules observed in R92.4: 3 characters for customers/items, 5 digits for workorders, 6 characters for claims, and the inventory serial pattern such as `I-1234567890` or `123456-1234567890`. Serial results link to their inventory product. This preserves the portal's existing inventory-serial coverage; it does not add a new device IMEI endpoint.

Appointment and Arrival results retain a plain type label. A unique customer match also loads their arrivals, matching regular portal search.

Authenticated customer, item, claim/workorder, and arrival endpoint response shapes were verified in Search.app. Automated tests use representative fixtures. The updated extension still needs reloading in the browser; its full live UI and serial results have not been verified.

## Workorder and Arrivals columns

Arrivals rows size to their content without shrinking, preserve native avatar dimensions, and use wider default customer/device columns. The Columns control stays beside Add new.

- Hover a table header to reveal its grip; drag it onto another header to reorder. Drag a header’s right edge to resize (100–600 px).
- Keyboard: Tab to a header grip or resize separator, then use Left/Right arrows.
- Open **Columns** beside **Device type** on Workorders or **Add new** on Arrivals. Every change applies immediately and is saved; the footer shows `shown of total` and the save state. **Done** closes the dialog — there is no Apply step.
- Every Workorders tab and the Arrivals page has its own saved visibility, order, and widths. **Apply to all tabs** copies the current layout to the other Workorders tabs; Arrivals is a single view, so its dialog omits that button and its copy.

### One catalog, no duplicates

Each column has a single logical id. When the portal’s own table renders a column — Device/Issue, Status, Program, Location, Total, Created, Last/Next update, Customer, WO # — that column appears in the dialog once, marked with a **table** badge and shown by default. When the current tab does not render it, the same column is offered as a data column (unchecked by default) filled from workorder data. A portal default such as **Device/Issue** or **Location** is therefore selectable on every tab, and a column never shows up twice.

Columns are grouped in the dialog as **Workorder**, **Program**, **Customer**, and **Device** (plus **Table** for headers this catalog does not recognise). Search filters the list, and the presets — *Portal only*, *Contact*, *Ops board*, *Everything* — apply live; the active preset stays highlighted. Presets never hide a column the table renders itself.

### Arrivals columns (0.7.0)

Arrivals has its own catalog aligned to the portal's own column list — **Program type**, **Appointment**, **Arrival status**, **Customer**, **Device** — with data columns **Arrival #**, **Client**, **Created**, **Updated**, **Missed arrival**, **Notes**, **Phone**, **Email**, **Contact prefs**, **Customer ID**, **City** and **Issues** available behind a click. Rows are matched to their records by customer name and email, so duplicated names still resolve to the right arrival.

Its dialog is grouped **Arrival**, **Customer**, **Device** (plus **Table** for headers this catalog does not recognise), its presets are *Portal only*, *Contact*, *Ops board*, *Everything*, and its copy describes arrival data rather than tabs. Data columns are filled from the portal's own `GET /api/arrivals/upcoming-arrivals` responses, forwarded the same way workorder data is; the extension never invents a value.

### Data columns

Extra columns (Status, Service outcome, Location, Total, Phone with contact permission flags, Email, Serial/IMEI, Passcode set — shown as `Set`/`—`, never the code, Issues, Items with device, and so on) are read from the portal’s own `POST /api/workorders` responses. `page.js` runs in the page world, observes those responses (and the arrivals list responses) and forwards the records to the content script; it never fabricates data. Clicking an extra header’s sort button sorts the rows on screen; clicking a portal header re-sorts through the portal and clears our order.

The extension keeps the portal’s existing cells and event handlers. Reordering and column visibility use CSS placement so React still owns the original DOM, sorting and links remain attached to the original fields, and extra cells are only appended in rows whose cell count matches the header so the portal’s `nth-child` styling stays valid. Screen-reader and keyboard traversal of the table still follows source order, which can differ from visual order.

### Appearance

The dialog and injected cells use the portal’s own `--aui-*` design tokens (Apercu, 16 px dialog radius, pill buttons, `--aui-primary`, `--aui-scrim-overlay`), so it follows the portal’s light/dark theme automatically and looks native in both.

## Support chat (0.8.2)

The UBIF Support chat opens on every portal page without covering it. Left alone, the widget's container stretches across the rest of the viewport while a conversation is open (the portal anchors it with `top`/`left` while the vendor pins it `bottom`/`right`), so every click lands on an invisible overlay and the portal has to be used from a second tab. The extension shrinks the container to the chat, lets clicks fall through to the page, and releases the widget's fullscreen `inert` lock on the portal — the movement and minimize controls keep the existing iframe mounted. Refresh and new-tab recovery use the vendor's existing session-resume mechanism.

- **Move it**: drag the bar across the top of the chat, or focus it and nudge with the arrow keys (Enter snaps it back under UBIF Support). The dropped position is saved under `ubif-plus.support.v1` and re-clamped on-screen after a reload. The portal's own re-anchoring runs constantly during a conversation; `!important` placement rules keep the panel where you put it.
- **Minimize it**: the **–** button on the drag bar hides the chat in place — the same `display`/`show` pair the portal's launcher uses. The iframe stays mounted and keeps running, so nothing is lost or reloaded; click the fixed **Resume support chat** button at the bottom right or **UBIF Support** in the header to come back. Header clicks are intercepted before the portal can rebuild the iframe.
- **Refresh recovery**: remembers open/minimized state, unread count, and unsent message text in this tab's `sessionStorage`, tied to Amazon Connect's `persistedChatSession`. A reload reopens a known resumable conversation through the portal launcher and restores the message composer without submitting it. The vendor reconnects the session and retrieves the transcript; the extension does not create a replacement contact.
- **Open in a new tab**: the **↗** button opens the same portal page with a copy of the current tab's session storage before the widget initializes, following [AWS's documented cross-tab session approach](https://docs.aws.amazon.com/connect/latest/adminguide/customize-widget-launch.html). The source chat stays visible until the destination acknowledges the vendor’s chat-connected event; only then is it minimized in place, with a Resume button. If connection is not confirmed within 30 seconds, the original remains available and displays an explanation. Repeated clicks focus the opened tab. A blocked popup or missing session leaves the original chat visible and displays an explanation. Use this button: an independently opened portal tab does not automatically share a chat session. No session values are put in URLs or new cookies.
- **Recovery limits**: an ended/expired conversation or expired portal login cannot be revived by this extension. Unsent file selections, uploads in progress, and pre-chat forms are not restored after a reload; finish uploads first. Drafts are copied when opening the new tab, not synchronized between tabs. Live AWS reconnection still needs verification with an authenticated portal conversation; automated tests cover local state recovery, delayed launcher readiness, the portal’s destructive restore handler, and the acknowledged tab handoff.
- **Notifications**: a message that arrives while the chat is hidden, or while the tab is in the background, grows a badge on the UBIF Support launcher and raises one desktop notification carrying the message text (read from the widget's own same-origin transcript). The notification refreshes as more messages arrive and is withdrawn, with the badge, when you return to the chat.

## Scope and privacy

The content script loads on this portal host to handle client-side navigation from other portal pages, with universal search active wherever the portal header is present. Column enhancements activate only on `/repair/workorders` and `/check-in/arrivals`. The permissions requested are `storage` (settings and column layouts) and `notifications` (the desktop note for support messages that arrive while the chat is hidden).

- Column ids, visibility, order, widths, and sort are saved in extension-local storage under `ubif-plus.columns.v1.*`.
- Feature toggles and timing preferences are saved in extension-local storage under `ubif-plus.settings.v1` and are written by the popup and full settings page.
- The popup’s **Feature request** and **Buy me a coffee** links open in a new tab when you click them; the extension itself makes no external requests.
- `page.js` only *reads responses the portal already made* (`POST /api/workorders` and `GET /api/arrivals/upcoming-arrivals`) and forwards them to the content script with `postMessage`. It does not send data anywhere.
- If a response is missed (for example the content script loaded late), the content script may re-issue the portal’s **own last captured request body once**, unchanged, to fill the visible cells. No new queries, no other endpoints, no credentials or customer data leave the page.
- Universal search sends read-only queries to the portal’s same-origin `/api/customers`, `/api/workorders` (POST lookup), `/api/repair/available-parts`, `/api/arrivals/upcoming-arrivals`, `/api/customers/<id>/arrivals` for a unique customer match, and `/api/boh/inventory/<serial>` endpoints using the existing session. Search results do not overwrite the column data feed.
- The Update Today board reads current-store work orders and notes and writes user-requested dates, supported status changes, workflow resets and notes through same-origin Portal APIs.
- The support-chat handling reads the widget's container, frame, same-origin transcript and message composer, and the vendor's existing session-storage resume value. Draft and UI recovery state stays in per-tab session storage; position stays in extension storage. Opening a chat tab inherits the portal tab's session storage without exporting it to another origin. Message text shown in a desktop notification travels from the content script to the extension's background worker and into the local notification; it is never sent anywhere else.
- No analytics, no telemetry, no third-party requests.

Only columns this catalog knows are offered as data columns; the adapter reads the observed `table > thead > tr > th[data-column-id]` structure for the portal-rendered set, and unknown headers still appear (grouped under **Table**) without invented fields. Portal markup changes may require an adapter update.

Implementation references: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Verification

See the [README](../README.md#development-and-verification) for the current development commands and verification limits. Earlier manual checks reported in this project covered table catalogs, portal data responses, scanning routes, the Home toggle, and light/dark styling. These do not establish that every current workflow has been verified live after later changes.
