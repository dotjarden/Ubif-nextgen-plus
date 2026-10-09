# Changelog

User-visible changes are recorded here. **Unreleased** describes work in the current checkout, not a published download. Earlier entries are reconstructed from repository commits; their dates identify those commits, not verified release-publication dates.

## [Unreleased]

No changes yet.

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
