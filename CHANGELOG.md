# Changelog

User-visible changes are recorded here. **Unreleased** describes work in the current checkout, not a published download. Earlier entries are reconstructed from repository commits; their dates identify those commits, not verified release-publication dates.

## [Unreleased]

### Added

- **Note templates**: eight work-order status and two lead templates under Portal's notes fields and the Update Today editor, and four check-in templates under Additional Details. Templates are inserted at the caret or beside existing text, never over it; wording is editable in Settings → Note templates with a per-template restore.
- **Keyboard shortcuts**: record a key combination for any template, Samsung form or dark mode in Settings → Keyboard shortcuts. Shortcuts work while typing, and combinations the browser or universal search use are refused.
- **Dark mode options**: a grayscale control and a dimmed variant.
- **Samsung forms**: a button on Samsung work orders opens the Sprinklr GD Bypass, Fenrir Bypass or WER Request form filled from the order (IMEI, device, GSPN ticket), your Portal profile and your store, after a review dialog. Forms are filled and left for you to submit by default; automatic submission for GD Bypass and WER Request is an opt-in setting. Labels are matched exactly and failures are listed on the form.
- **Dark mode** (Settings → Appearance, off by default): darkens the portal and the extension's panels using the bundled Dark Reader engine, with an option to follow your device's light/dark setting and brightness, contrast and sepia controls. Black and grey logos and icons, including table device icons, turn light; photos and colored branding keep their colors. Printing is unchanged, and reloads start dark without a white flash.

## [0.9.0] — 2026-10-16

### Added

- **Update Today messages**: the editor's Messages button opens Portal's customer conversation beside the editor, keeping unsaved notes and scheduling fields. It toggles to Hide messages, and closing the editor closes the conversation it opened. Portal owns history, templates, contact preferences and sending.
- **Customer message templates** in the shared Arrivals/Workorders customer chat: a searchable library with two quick shortcuts, a visual editor that inserts readable detail chips (first name, device, appointment, work order and more) at the cursor, alternate text for missing details, customer previews, copy and undo-delete. Workorder templates resolve the linked arrival appointment and missing contact details automatically; Arrivals reads the selected customer card.
- **Check-in Extra Details**: Model, Color, Device Issue, FMIP, Accessories Offered, Services Offered, ETA and Price Est above the native Additional Details on standard and Samsung diagnosis forms, saved into the order's notes through the normal check-in. All eight are required before continuing. A **Battery not working** shortcut selects "Can't test" in every native category and fills required test-reason notes.
- **Sidebar improvements** (Settings → Home, on by default): 40 px rows with the More chevron at the row edge; Support Ticket, Enhancement Idea and then More (last, its menu opening below) grouped at the bottom above the collapse arrow; collapsed icons named in tooltips and to screen readers; the whole More row opens its menu (expanding a collapsed sidebar first) instead of opening Dashboard; Support Ticket and Enhancement Idea styled like the rest of the sidebar with icons; the last collapse choice kept after resizing a wide window.
- **Workorders table**: oldest/newest sort buttons for Created and Next update with a saved direction per tab, and an optional Line items / SKUs column loaded with bounded concurrency.
- **Arrivals pagination**: 10/25/50/100 rows per page, matching Workorders, with a saved preference and controls in Settings → Tables.
- **Buyback printing in search**: Print buyback beside item and sold-serial results, with a sold-serial chooser and a Universal search setting.
- **Employee name in the header**: your first name replaces the profile icon and opens the same account menu, with an optional first-name override in settings. RT iPhone and RT Android appointment confirmations join the templates.
- New settings for message templates, quick shortcuts, the employee label, check-in Extra Details, the battery shortcut, inline search result tags and the sidebar improvements.
- A Windows daily ZIP update helper.

### Improved

- **Update Today board**: cards open from anywhere (the WO link still opens Portal) with a compact Update button and overdue times in red; statuses with nothing due collapse into a strip of drop targets above the lanes so orders are on screen first.
- **Update Today editor**: the portal font and pill buttons; status and next update in the header; progress on the button that started it (spinner, then ✓) with the message bar kept for problems; a future time suggested instead of a past one; links in notes are clickable; focus starts on the title; ⌘/Ctrl+Enter adds a note or saves a status change; a full-height status dropdown.
- Universal search shows native-style program, source, status and claim tags inline in each result.
- Template shortcuts match Portal's quick-reply buttons, and Update Today's tab matches the native tab typography and selection indicator.
- New icon artwork: a dark rounded tile with a white **U** and a sky-blue plus, rendered from `icon.svg`.

### Fixed

- **Scanning into Portal's own scan fields**: the check-in Add Arrival / Schedule Appointment panel, work-order Scan label and Work in progress, Repair Estimate and check-out now receive scans instead of universal search. An open panel never opens a work order from a numeric SKU, and Tab-terminated scans there arrive as one native scan.
- SKU and part-number scans into Portal's search bar, dialog inputs and work-order part inputs are no longer blanked or redirected.
- Consecutive scans into universal search keep and select the newest query. Inventory routes keep scans in their native workflow; count editors receive one native scan, including Tab-terminated scans.
- Update Today notes load for orders that also have notes on their arrival or customer (labelled Arrival / Customer); a note naming a different order still blocks the list.
- Resume support chat moves beside Portal's customer conversation instead of covering its message box.
- The header search field keeps a gap before UBIF support instead of touching it.
- Include tomorrow saves through shared settings, and data columns refresh when new feed or cart data arrives.
- Employee names attach to Portal's actual avatar control with native typography and follow signed-in user changes.
- Message templates stay anchored above the composer across rerenders, keep the cursor when detail buttons are clicked, and recover appointment details when chat opened before the extension loaded.
- Reordered table cells keep side borders and rounded corners at the visible table edges.
- The Windows updater runs from the installation's scripts folder.

### Upgrade notes

- Existing settings, templates and column layouts are kept. New features are on by default and can be switched off in settings.
- Reload the extension, then refresh portal tabs. Physical-scanner timing in the check-in panel and authenticated Update Today writes should be confirmed in the live portal.

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
