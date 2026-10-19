# Feature guide

[← Back to the README](../README.md) · [Changelog](../CHANGELOG.md)

Detailed behavior and limitations for UBIF NextGen Plus.

## Settings

Click the extension's toolbar icon for settings, then use the category navigation or **Find a setting** to locate a control. **Open in tab** opens the same controls in a browser tab; Chrome's extension **Options** opens that page too. Settings save immediately and apply to open portal tabs. Related controls are disabled when their parent feature is off, and each category has its own reset button. A failed save restores the previous value and displays an error.

- **Home**: hide the Home calendar to give Quick actions and Today's to-do's more room, and turn the [sidebar improvements](#sidebar-090) on or off.
- **Appearance**: turn on [dark mode](#dark-mode-unreleased) or its dimmed variant, limit it to when your device uses dark mode, and set brightness and contrast (50–150%), sepia and grayscale (0–100%).
- **Note templates**: show [note templates](#note-templates-unreleased) under work-order notes and check-in Additional Details, and edit each template's wording.
- **Keyboard shortcuts**: turn [shortcuts](#keyboard-shortcuts-unreleased) on or off and record a combination for each action.
- **Universal search**: enable search, configure the shortcut, delay (100–2,000 ms) and minimum query length (3–10), choose each of the five result categories, and open results in new tabs. Disabled categories make no search requests. Work orders still require at least 5 digits and claims at least 6 characters.
- **Update Today**: enable the board, include tomorrow by default, toggle periodic refresh and set its interval (15–600 seconds), allow status drag and drop, and show or hide empty status columns. Opening or returning to the board still refreshes it with periodic refresh off.
- **Barcode scanning**: enable scanning, independently control opening work orders/portal links and forwarding other scans to search, enable purchase-order receiving, and choose automatic OEM field focus and confirmation. Turning confirmation off leaves valid serials for manual review.
- **Samsung forms**: show the [Samsung forms button](#samsung-exception-forms-unreleased), submit GD Bypass and WER Request forms automatically (off by default), and set the repair location type, Galaxy Diagnostic Tool version and an email override.
- **Tables**: enable custom columns separately for Workorders and Arrivals, toggle Arrivals pagination, and choose 10/25/50/100 rows per page. Manage visible columns, order, widths, presets, and layout resets with **Columns** on the relevant portal table, where the current tab's data is available.
- **Support chat**: enable the movable/minimizable support window, desktop notifications, unread badges, and notification message previews separately. Disable previews for a generic new-message notification.

Existing preferences are preserved. New settings retain the previous behavior by default; opening search results in a new tab is off by default. Category resets only restore that category's preferences, leaving saved column layouts intact. **Feature request** and **Buy me a coffee** open in new tabs.

Settings live in one extension-local storage record (`ubif-plus.settings.v1`) shared by the popup and full settings page. No new permissions are required for the settings page.

## Dark mode (Unreleased)

Turn it on in **Settings → Appearance** (off by default). Changes apply to open portal tabs immediately. **Only when my device uses dark mode** follows your operating system's light/dark setting and switches with it. Brightness, contrast, sepia and grayscale adjust the result. **Dimmed instead of dark** softens bright whites without a dark background; icon inversion is skipped in that mode.

The extension bundles [Dark Reader](https://darkreader.org/)'s dynamic theme engine (MIT, pinned in `package.json` and copied to `extension/vendor/` by `npm run vendor`). It recalculates the colors of the portal's own stylesheets and of the extension's panels, so it keeps working when Portal class names change. It runs in the extension's isolated content-script world and does not patch the page's JavaScript. Its styles are screen-only, so printed pages and labels are unchanged. The support chat window is a separate site in a frame and stays light.

Black and grey logos and icons, such as the device icon in tables, turn light. The engine already recolors inline SVG icons and CSS background icons. It leaves `<img>` elements alone, so the extension samples each portal image (downscaled on a canvas, cached per URL). An image that is at least 20% transparent and drawn in one black or grey tone is recolored to the light text tone. A mostly black logo with colored accents is inverted with its hue kept. Photos, colorful artwork and colored branding such as the purple wordmark are unchanged. Images from another site that does not allow reading their pixels are left as they are.

To avoid a white flash on reload, the on/off state is mirrored to a `ubif-plus.dark-hint` value in the portal's local storage, which paints a dark background until the engine starts.

## Note templates (Unreleased)

A **Note templates** button sits under Portal's work-order notes (`data-testid="notes-input"`), the note boxes in Portal's status dialogs (`notes-area-text-field`) and both note boxes in the Update Today editor. It offers eight status templates and two lead templates:

- **Status:** Repair/Diag In Progress, Awaiting Diag, Awaiting Diag (Price Quote Ready), Awaiting Callback/Device, Quality Inspection, Repaired/Unrepairable RFP, Declined RFP (In Store), Need to Order Parts (Multiday).
- **Leads:** Lead (Customer Contacted), Lead (Customer NOT Contacted).

A **Check-in templates** button sits under check-in Additional Details (`additional-details-note`, or `DeviceDiagSubIssues_Notes` on Samsung). It offers Multiday Device, Insurance Mobile Device, In Warranty Device and OOP Mobile Device notes.

The wording follows the Tech FOH Cheat Sheet. Search the menu by name or content.

A template never replaces what you wrote:

- **Where it goes:** at the caret you last placed in the field. Without a caret it goes at the end of work-order notes, or at the start of check-in notes, so Extra Details stays last. A blank line separates it from existing text.
- **Notes limit:** a template that would push the field past its limit (2,000 characters) is refused with a message.
- **How it reaches Portal:** inserted through the field's normal input event, so Portal saves it like typed text.

Edit any template's wording in **Settings → Note templates**. Edits save as you type, are marked Edited, and **Restore default** brings back the standard wording. An unedited template follows future wording updates. Wording is stored in extension storage (`ubif-plus.note-templates.v1`).

## Keyboard shortcuts (Unreleased)

**Settings → Keyboard shortcuts** lists 18 actions: any of the 14 templates, each Samsung form, and turning dark mode on or off. Nothing is bound by default. To record a shortcut, click its button and press the combination. **Backspace** clears it and **Escape** cancels.

- Every shortcut needs Ctrl, Alt/Option or Cmd, so it also works while typing in a notes field.
- Keys are read by physical position, so Option+letter works on a Mac.
- Combinations that universal search (Cmd/Ctrl+K) or the browser already use, such as Ctrl/Cmd+C, are refused.
- A combination already used by another action is refused, with the action named.

A template shortcut inserts into the notes field you last used, or the only one on the page. Otherwise it says what to open first. A Samsung form shortcut opens that form's review dialog on a Samsung work order. Bindings are stored in extension storage (`ubif-plus.hotkeys.v1`), and shortcuts are shown beside templates in the menu.

## Samsung exception forms (Unreleased)

On a Samsung work order (a Galaxy/Samsung device, or any order with a GSPN ticket) a **Samsung forms** button appears beside the work order heading. It opens a review dialog for one of three Sprinklr requests:

| Request | Sprinklr choices | Details used |
| --- | --- | --- |
| **GD Bypass** | Exception Request → Galaxy Diagnostic Tool → Asurion Repair | Galaxy Diagnostic Tool version, device SKU, GSPN ticket, work order, IMEI |
| **Fenrir Bypass** | Exception Request → Fenrir → Customer Declined SW Update, SVC Connection Performed = Yes | GSPN ticket, work order, IMEI |
| **WER Request** | Process Requests → WER Request | Work order, IMEI |

Every request also sends your email, technician name, store number (UBIF Location), store email and repair location type. They are prefilled as follows:

- **Email and name:** your Portal profile.
- **Store number and store email:** the current store's name. For "Manchester CT #878" that gives 878 and `manchesterct@ubreakifix.com`.
- **IMEI and device SKU:** the order's device.
- **GSPN ticket:** the order's partner job, falling back to a "Ticket no." note.

Every value can be edited. Missing or malformed details are marked and keep the form from opening. Your repair location type and GD tool version are saved as settings, a corrected store email is remembered for that store, and an edited email is kept as your email override.

**Open Sprinklr form** opens the form in a new tab and fills it from top to bottom, waiting for each follow-up question to appear. Fields are matched by their exact label, so "Email Address" never lands in "Store Email Address", and the store is chosen by whole number, so #878 never picks #1878. A banner on the form reports the result:

- **Default:** the form is left filled for you to review and press Submit.
- **Automatic submission (Settings → Samsung forms):** GD Bypass and WER Request are submitted, but only when every field filled.
- **Fenrir:** never submitted automatically, because the SVC connection screenshot must be attached first.

Any field that could not be filled is listed by name so you can complete it.

The worker opens only the fixed Sprinklr form URL. It keeps the validated details in extension session storage for that one tab, which content scripts cannot read directly. A Sprinklr tab the extension did not open is never filled, and the details are dropped when the form reports back, the tab closes, or 15 minutes pass. Data sources were checked against Portal's public R92.4 frontend: `GET /api/workorder/:id` (`CustomerDevice.imei`, `CustomerDevice.DeviceCatalog.name`, `PartnerJob.PartnerJobAttributes` type 53 = GSPN ticket), `GET /api/note` for the fallback, and `@ubif/util-store`'s `auth.user` and `auth.currentStore`. The Sprinklr form was modeled on its observed field labels; an authenticated end-to-end check against the live form is still outstanding.

## Sidebar (0.9.0)

The portal's left navigation keeps its own markup and state; the extension only labels and restyles it. Turn it off in **Settings → Home → Sidebar improvements**.

- **Spacing**: rows are 40 px with a 2 px gap (the portal uses 48 px with 8 px), More sub-items are 34 px, and the More chevron sits at the row's edge, so the list fits shorter windows without scrolling.
- **Bottom group**: Support Ticket, Enhancement Idea and then More — the last item, with its menu opening below it — sit together at the bottom of the sidebar, just above the collapse arrow, in both the expanded and collapsed views. The main destinations stay at the top; the list still scrolls when an open More menu does not fit.
- **Collapsed rail**: each icon has a tooltip and an accessible name taken from its expanded label (Dashboard, Arrivals, Workorders, …). The collapse button announces **Collapse/Expand navigation** and its state; the More chevron reports whether its menu is open.
- **More**: the whole row opens or closes its menu. Natively only the small chevron does, and the rest of the row is a link to Dashboard. In the collapsed rail, More expands the sidebar and opens its menu.
- **Support Ticket and Enhancement Idea**: these come from an Appcues embed, not the portal. They now use the portal font, theme colours (including dark mode), the same row size and hover state, gain ticket and lightbulb icons, sit just above More, and show icon-only with tooltips when collapsed instead of clipped text.
- **Collapse choice**: the portal re-forces open/closed whenever the window width changes. On windows at least 1,280 px wide, the last choice you made with the collapse button is put back after a resize. Narrower windows keep the portal's overlay behaviour.

Contracts were read from the public R92.4 `ubif-components.js` (Nav), `ubif-util-store.js` (`layout.nav.closed`, `layout.more.closed`) and the live Appcues shadow root. Automated fixtures cover labels, More, Appcues re-renders, resize restoration and the setting.

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

**Portal scan fields win.** The portal reads scans itself through a window `keypress` detector and a `scanDetected` event. While one of its consumers is on screen, scans are left to the portal instead of universal search: an open side panel (`role="status"`, `aria-live="assertive"`, `aria-hidden="false"`, such as check-in **Add Arrival** / **Schedule Appointment**) or Asurion modal containing an input or scan field, or a visible **Scan or enter item label** field (barcode icon), Repair Estimate scan field or check-out refund screen. Inside an open panel, numeric scans never open a work order; a scan field on the page itself still lets work-order numbers and portal links open. A Tab-terminated scan there is delivered as one native `scanDetected` event, since the portal's detector only ends on Enter. Typing into universal search always stays in search.

Use a keyboard-mode barcode scanner configured to end each scan with **Enter** or **Tab**. Detection requires a rapid burst (at most 80 ms between keys and a 40 ms average including the terminator). Ordinary typing retains its normal behavior. When scanning into an input or textarea, its previous value and selection are restored before navigation or search. Outside purchase-order receiving, other barcode types still use the portal's existing workflows. Scanning inside an embedded frame is not supported.

Reload the extension and the portal after updating. Scanner routing is covered by automated tests; physical scanner timing still needs verification with your scanner.

## Universal search

The portal header contains an always-visible **Search everything…** field on every page (when the portal collapses its own search box at narrow widths, the field parks in the visible header instead, so a scanned query and its results are always on screen). Type once to search Customers, Work orders, Items, Claims (including upcoming arrivals), and inventory Serial numbers. Results are grouped with direct links; there are no category tabs to select. Cmd/Ctrl+K focuses search, Enter searches immediately, arrows move through results, and Escape dismisses them. A barcode scan fills this field too — see [scanning](#scan-to-open-a-work-order-or-search-anything-else-070).

Search waits 350 ms after typing, cancels superseded requests, and keeps successful categories visible if another fails. Queries and results are held in memory only. It uses the same portal endpoints and input rules observed in R92.4: 3 characters for customers/items, 5 digits for workorders, 6 characters for claims, and the inventory serial pattern such as `I-1234567890` or `123456-1234567890`. Serial results link to their inventory product. This preserves the portal's existing inventory-serial coverage; it does not add a new device IMEI endpoint.

Appointment and Arrival results retain a plain type label. A unique customer match also loads their arrivals, matching regular portal search.

Authenticated customer, item, claim/workorder, and arrival endpoint response shapes were verified in Search.app. Automated tests use representative fixtures. The updated extension still needs reloading in the browser; its full live UI and serial results have not been verified.

## Customer message templates (0.9.0)

Arrivals and Workorders use the same customer chat sidebar. Two compact shortcuts sit above the existing message box, beside **Templates**. Click a shortcut to fill the message box with the selected customer’s details, then press the Portal’s Send button. **Templates** opens a searchable library above the shortcuts without pushing the composer off-screen. Each row shows a preview with the selected customer's details and an **Edit** action. Definitions are saved locally for this browser profile; customer records and resolved previews are never persisted. Existing v1 templates remain compatible. Reload the extension and refresh the Portal tab after updating.

Choose **New template** or **Edit**, give it a name, and write your message in the visual editor. Click **First name**, **Device**, **Appointment**, or **Work order number** to insert a readable detail chip at your typing cursor. The editor remembers this position when you click away to another field or open More details. Selected text is replaced, and the cursor stays after the chip so you can keep writing. **More details** offers contact information, model, reported issues, status and next update. Click a chip to set **If unavailable, use this text**, or remove it. First name and Device start with alternate text (“there” and “your device”). No placeholder syntax is needed. A preview shows the message for the current customer. Save/Cancel stay visible; **Make a copy** creates a variation, and deletion offers **Undo**.

Arrivals supplies its displayed device and appointment information, or the original arrival when its summary omits details. Workorders combines the selected chat order with its linked arrival and, when needed, the selected customer’s contact response. A template clicked while these details load fills automatically when loading completes; available details never require re-entry. If a needed detail is unavailable and has no alternate text, using the template prompts you to fill it for this message. These one-time values are never saved into the template. If the message box already has text, explicitly choose **Add to draft** or **Replace draft**; selecting a template preserves your draft.

Using a template fills the Portal's own message box. Sending uses the Portal's own controls, and its disabled SMS state is respected. A main-world adapter reads the existing global store's selected chat customer through `System.get(System.resolve('@ubif/util-store'))`, `selectChatPanelData` and `selectChatPanelOpen`; it never dispatches actions. At Arrivals' chat launch and while chat is open, it reads only allowed customer/device/appointment fields from the matching displayed customer card's mounted React fiber. This recovers details if chat opened before injection or a launcher click was missed, and tracks updated appointments. Multiple arrivals for the same customer are not guessed between. Workorder details use same-origin `GET /api/workorder/<id>`, checked against the selected chat order number and customer ID when supplied. Linked arrivals use `GET /api/workorder/<id>/arrival`; missing contact details use `GET /api/customers/<customerId>?clientId=<clientId>` when both IDs are available on the selected order. Returned identifiers are checked before merging. Switching chat customers or launch contexts clears the previous preview, and responses for an old context are ignored. If data cannot be loaded, the preview uses fallbacks and reports missing fields.

The shared panel structure, store exports and Arrivals launch props were checked against the Portal's public R92.4 `ubif-components.js`, `ubif-util-store.js`, `ubif-check-in.js` and `ubif-repair.js` bundles. Tests reproduce its styled-div panel and native form with `aria-label="Send message"`, rather than assuming a Messages heading. Automated fixtures cover both entry points, storage, insertion, unavailable data, disabled SMS and customer switching. The redesigned picker, cursor insertion, visual editor, saving and draft insertion were also checked in the fictional-data browser preview at `/messages` (run `node demo/server.cjs`). An authenticated end-to-end browser check remains outstanding.

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

### Arrivals pagination

Arrivals offers **10, 25, 50, or 100 rows per page**, matching Workorders. The compact selector shares the existing Add new/Columns toolbar (or the native pagination footer when no toolbar is available) and saves its choice in extension-local storage in the shared settings record (`arrivalsPageSize` in `ubif-plus.settings.v1`). Changing the size returns to page 1 while preserving the current search, filters, and appointment sort. The portal continues to fetch and render the table and operate its First/Previous/Next/Last controls. This feature works independently of custom columns. Open addon settings → **Tables** to enable or disable it and choose the page size. The portal dropdown and settings stay in sync across tabs. Turning pagination off restores 10 rows per page while retaining your selected size for when it is re-enabled. Earlier saved page-size preferences are preserved.

The adapter uses the observed Arrivals React query and pagination state from the public R92.4 frontend. If that structure changes, the selector disables itself and reports that the layout is unsupported. Automated checks and a fictional-data reproduction using the portal’s actual pagination component cover page-size changes and navigation; authenticated Arrivals API behavior still needs a live check.

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

The content script loads on this portal host to handle client-side navigation from other portal pages, with universal search active wherever the portal header is present. Column enhancements activate only on `/repair/workorders` and `/check-in/arrivals`. The permissions requested are `storage` (settings and column layouts) and `notifications` (the desktop note for support messages that arrive while the chat is hidden). A second content script runs on `forms-prod.sprinklr.com` only to fill a Samsung exception form that you opened from a work order.

- Column ids, visibility, order, widths, and sort are saved in extension-local storage under `ubif-plus.columns.v1.*`.
- Feature toggles and timing preferences are saved in extension-local storage under `ubif-plus.settings.v1` and are written by the popup and full settings page.
- The popup’s **Feature request** and **Buy me a coffee** links open in a new tab when you click them; the extension itself makes no external requests.
- `page.js` only *reads responses the portal already made* (`POST /api/workorders` and `GET /api/arrivals/upcoming-arrivals`) and forwards them to the content script with `postMessage`. It does not send data anywhere.
- If a response is missed (for example the content script loaded late), the content script may re-issue the portal’s **own last captured request body once**, unchanged, to fill the visible cells. No new queries, no other endpoints, no credentials or customer data leave the page.
- Universal search sends read-only queries to the portal’s same-origin `/api/customers`, `/api/workorders` (POST lookup), `/api/repair/available-parts`, `/api/arrivals/upcoming-arrivals`, `/api/customers/<id>/arrivals` for a unique customer match, and `/api/boh/inventory/<serial>` endpoints using the existing session. Search results do not overwrite the column data feed.
- The Update Today board reads current-store work orders and notes and writes user-requested dates, supported status changes, workflow resets and notes through same-origin Portal APIs.
- The support-chat handling reads the widget's container, frame, same-origin transcript and message composer, and the vendor's existing session-storage resume value. Draft and UI recovery state stays in per-tab session storage; position stays in extension storage. Opening a chat tab inherits the portal tab's session storage without exporting it to another origin. Message text shown in a desktop notification travels from the content script to the extension's background worker and into the local notification; it is never sent anywhere else.
- Dark mode reads the portal's stylesheets to recolor them. A stylesheet the portal loads from another site (such as a font stylesheet) may be fetched again for this; nothing is sent with it.
- Samsung forms put your email, name, store and the order's work order number, IMEI, device and GSPN ticket into Sprinklr's form fields, in a tab you opened, only after you review them. Nothing is sent to Sprinklr until the form is submitted, by you or, if you turned it on, automatically.
- No analytics, no telemetry, no third-party requests.

Only columns this catalog knows are offered as data columns; the adapter reads the observed `table > thead > tr > th[data-column-id]` structure for the portal-rendered set, and unknown headers still appear (grouped under **Table**) without invented fields. Portal markup changes may require an adapter update.

Implementation references: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Verification

See the [README](../README.md#development-and-verification) for the current development commands and verification limits. Earlier manual checks reported in this project covered table catalogs, portal data responses, scanning routes, the Home toggle, and light/dark styling. These do not establish that every current workflow has been verified live after later changes.

## Buyback label shortcut

Search a SKU as usual, then click **Print buyback** beside its item result. The shortcut loads all inventory pages for the current store. One sold serial opens its linked work order and requests the native buyback print action. With several sold serials, choose the serial to print. No sold serials produces an empty-state message. Sold inventory serial results, and part serials reserved to a work order (attached but not yet sold), have their own button that uses that exact serial and opens that work order. Result links still open the product page. The chooser and lookup messages stay under the specific result.

Toggle **Universal search → Buyback buttons in search** in extension settings. It is enabled by default; turning it off removes the buttons and cancels pending lookups. Turning universal search off also disables this shortcut. Buyback printing opens the linked work order in the current tab.

Before navigating, the serial must still belong to the SKU and have a work order link, plus either Sold status with a sales order number or Reserved status. Portal's own cart action still decides whether the label can print (for example, it stays disabled until the work order is ready for pickup). The shortcut uses Portal’s mounted cart action, including its eligibility/permission checks, buyback cart updates, and configured printer. An unavailable or disabled action leaves you on the work order with an explanation. “Print requested” means Portal received the action; check its printer/error messages for the actual result. The shortcut never automatically retries a print.

A pending request stays only in this tab’s session storage, expires after one minute, and is removed before printing. Reloading the work order does not reprint. Native printer output still needs validation in a signed-in Portal tab.

### Employee names, RT confirmations, and feature settings

The template detail picker includes **Employee first name**. **RT iPhone** and **RT Android** are added once to existing libraries, with the appointment date and time and employee name filled in when available. The iPhone confirmation includes the Stolen Protection reminder. Existing templates remain editable; deleting an RT template after migration keeps it deleted. Missing names or appointment times are requested before insertion.

In **Settings → Messages & employee**, enable message templates, show or hide the first two quick shortcuts, replace the header profile icon with an employee name button that opens the same account menu, and set a local first-name override. An empty override uses the signed-in profile when the Portal exposes it. Names from the Portal remain in memory. The template library is managed in the message sidebar.

**Settings → Check-in** controls Extra Details and its required-field check, and the Battery not working shortcut. Disabling Extra Details leaves existing notes intact. **Settings → Universal search → Inline result tags** shows program, source, status, and claim details inside each result using the Portal’s tag colors. Category source toggles still control which searches run.

The template bar follows the composer after conversation rerenders. Table side borders and rounding follow the first and last visible columns after reordering or hiding fields. Update Today uses the native tab label typography, spacing, muted inactive text, and 4px on-surface active indicator.

The employee header anchor (`.components-header-opts-avatar`), signed-in name (`selectUser(state).givenName`), native tab structure, and inline result tag colors were checked against the R92.4 Portal components and its Asurion UI bundle.

## Item label shortcut

Scan or search an inventory serial (for example `400559-0000003979` or `I-0000003979`). When the serial is **Available**, its result shows **Print label**. One click prints the same label as Portal's item details → **Reprint Label** → **Confirm**: the product name and the full SKU-serial barcode on Portal's default 30330 label, sent to the first connected Dymo LabelWriter. The button disables briefly after a print so a double click or bounced scan does not print twice.

Like Portal, the button is not offered for sold or other non-available serials or the buyback SKU (BB0001). After a successful print the extension writes Portal's `ReprintLabel` user action log entry (`Reprinted label for part …`), so the audit trail matches the native flow; only the confirmation dialog is skipped.

Toggle **Universal search → Item label buttons in search** in extension settings (on by default). Turning universal search off also removes the buttons.

Implementation notes: printing runs in `label-page.js` in the page's main world, using Portal's own `window.dymo.label.framework` (`getLabelWriterPrinters`, `openLabelXml`, `LabelSetBuilder`). The label XML is copied from Portal's `ubif-components.js` `LabelType.DefaultLabel`; if Portal changes its template, update the copy. Not mirrored from the native flow: its `InventoryManagementPurchasing` permission check on the button, and the "with active inventory count" suffix on the log entry. A physical print still needs a live check in a signed-in Portal tab.

## Copy IMEI on work orders

On a work order, each line Portal shows as `IMEI: <number>` (the device card, and any other IMEI line on the page) gets a small copy button after the number. One click copies only the digits; the button turns green and reads **Copied** for 1.5 seconds. The click never opens Portal's device editor behind it. Lines without a real 14–17 digit IMEI (such as `IMEI: N/A`) get no button.

Toggle **Work orders → Copy IMEI button** in extension settings (on by default). The button follows Portal's re-renders and moves to a changed IMEI. The real device card markup was taken from Portal's `ubif-components.js` (`device_info.imei` line); a live check in a signed-in work order is still needed.
