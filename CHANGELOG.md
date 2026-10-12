# Changelog

User-visible changes are recorded here. **Unreleased** describes work in the current checkout, not a published download. Earlier entries are reconstructed from repository commits; their dates identify those commits, not verified release-publication dates.

## [Unreleased]

### Added

- Extra Details above the native Additional Details section on standard and Samsung diagnosis forms: Model, Color, Device Issue, FMIP, Accessories Offered, Services Offered, ETA and Price Est. Entries join existing Notes / Additional Details and save through the normal check-in workflow. ETA accepts a time, date or “unsure.” A “Battery not working” shortcut above native diagnosis categories selects “No issues” for each category and preserves Extra Details.

- Add inline Print buyback buttons beside item and sold serial search results, a sold-serial chooser, and a Universal search setting to show or hide the buttons. Printing uses the linked work order’s native action.

- Customer message templates inside the Messages sidebar: create, edit and delete locally saved templates, insert customer/device/work order/appointment fields with optional fallback text, and personalize a real-data preview before inserting into the Portal composer.

### Improved

- Message templates now use compact shortcuts and a searchable library. A visual editor inserts readable detail chips at the typing cursor, provides customer previews and simple alternate-text settings, and supports copying templates and undoing deletion. Missing required details prompt for one-time values, and existing drafts offer explicit Add or Replace actions.

- Arrivals now offers the same 10/25/50/100 rows-per-page choices as Workorders, with native table pagination, a saved preference, and a toggle and page-size dropdown in addon settings → Tables.

- New icon artwork: a dark rounded tile with a white **U** and a sky-blue plus, sourced from `icon.svg` and rendered into every toolbar, notification, and store-facing asset. The previous raster art is kept as `old-icon.jpeg`.

### Fixed

- Message templates recover appointment/device details from the matching mounted arrival when chat is already open or its launch click was missed. Late arrival data completes the original template selection and removes the unnecessary missing-appointment prompt.

- Saved templates automatically resolve the selected workorder's linked arrival appointment and missing customer contact details. Clicking while details load completes insertion after loading instead of asking for information that is already on the record. Arrivals also reads the original arrival when its summary omits appointment time.

- Template detail insertion preserves the message cursor after clicking another field or detail button, including browsers that expose selections at the shadow host.

- Message templates now attach to the actual shared customer ChatPanel used by Arrivals and Workorders, including panels titled with the customer's name. Arrivals templates read the selected customer card's device and appointment information; Workorders templates follow the chat's selected order.

- Scanning a product SKU or part number into the portal's own search bar, or into the "add part" input on a work order diagnostic stage, no longer blanks the field. The scanner now detects portal-owned inputs — any input inside an open dialog and inputs on work order detail pages — and lets the portal handle the scan natively instead of redirecting it to universal search.

Sources: [`405d926`](https://github.com/dotjarden/Ubif-nextgen-plus/commit/405d926).

## [0.8.3] — 2026-10-09

### Added

- Searchable settings with category navigation, a full-page view, and per-category resets.
- Nineteen additional controls for search categories and new tabs, scan workflows and OEM confirmation, table-specific customization, board refresh/dragging/empty columns, and support alerts/privacy.
- Movable and minimizable support chat, a persistent resume control, unread badges, and desktop notifications.
- Support draft/session recovery on refresh and an acknowledged handoff when opening chat in a new tab.
- A guarded Git update helper, version synchronization, reproducible release ZIPs with SHA-256 checksums, and CI with tag-triggered draft releases.
- An Updates & help settings page and clearer feature-request and Buy Me a Coffee buttons.

### Improved

- Settings now use a neutral sidebar, clearer section headings, and concise descriptions beneath each control. Extra subheadings and the persistent footer tagline have been removed.
- Feature request and Buy Me a Coffee links use compact buttons, leaving more room for the settings form.
- Full-page settings use horizontal navigation on narrow screens. The toolbar popup retains a fixed 680px width.
- Valid numeric settings apply while typing, without waiting for the field to lose focus.
- README installation, updating, privacy, troubleshooting, and developer guidance; detailed behavior now has its own feature guide.
- Update Today presents scheduling, status changes, and notes in a more organized order dialog.

### Fixed

- Cramped toolbar settings caused by viewport-dependent popup sizing.
- Rapid settings edits being dropped while an earlier save was pending.
- Conflicting edits from multiple settings pages and delayed storage reads overwriting newer preferences.
- Suspended portal tabs missing settings changes; tabs reconcile saved preferences when they resume.
- Unrelated settings edits resetting the board’s date filter or refresh timer, restarting search, or interrupting scanner input.
- Support unread counts not updating immediately when badges are re-enabled. Disabling notification previews also clears an existing text notification.
- Failed saves leaving controls showing values that were not stored.
- Search results shifting during a click as responses arrive, and the search field becoming unreachable in narrow portal headers.

### Upgrade notes

- Existing preferences and column layouts remain in extension-local storage. New controls preserve prior behavior by default; opening results in new tabs defaults to off.
- Support desktop alerts require the `notifications` permission present in the working manifest. Review Chrome's permission prompt if upgrading from older source.
- Version **0.8.3** packages the settings, support chat, and update improvements previously available only from source.
- Reload the extension and portal tabs after installing changed source. Live scanner timing, board writes, and support reconnection still require portal verification.

## [0.7.0] — 2026-10-08

### Added

- Arrivals column catalog and presets, with layouts independent of Workorders tabs.
- Universal scan routing: work orders open directly, other supported scans go to search, and portal QR links open their route.
- A Home-calendar visibility setting.

### Improved

- Arrivals table sizing and placement of its Columns control.

Source: [`c2fad27`](https://github.com/dotjarden/Ubif-nextgen-plus/commit/c2fad27).

## [0.5.0] — 2026-10-08

### Added

- Update Today board for active work orders due today or earlier, with an optional tomorrow view.
- Scheduling, portal notes, and supported status transitions.
- Extension icon assets in a subsequent commit.

Sources: [`2501e88`](https://github.com/dotjarden/Ubif-nextgen-plus/commit/2501e88), [`1fc10a9`](https://github.com/dotjarden/Ubif-nextgen-plus/commit/1fc10a9).

## [0.4.1] — 2026-10-08

### Added

- Initial committed extension with purchase-order receiving scans, universal search, and saved column layouts.
- Automatic OEM serial focus and confirmation after portal validation in a subsequent commit.

Sources: [`93036cc`](https://github.com/dotjarden/Ubif-nextgen-plus/commit/93036cc), [`e059cf8`](https://github.com/dotjarden/Ubif-nextgen-plus/commit/e059cf8).
