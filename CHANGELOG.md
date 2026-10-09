# Changelog

User-visible changes are recorded here. **Unreleased** describes work in the current checkout, not a published download. Earlier entries are reconstructed from repository commits; their dates identify those commits, not verified release-publication dates.

## [Unreleased]

### Added

- Searchable settings with category navigation, a full-page view, and per-category resets.
- Nineteen additional controls for search categories and new tabs, scan workflows and OEM confirmation, table-specific customization, board refresh/dragging/empty columns, and support alerts/privacy.
- Movable and minimizable support chat, a persistent resume control, unread badges, and desktop notifications.
- Support draft/session recovery on refresh and an acknowledged handoff when opening chat in a new tab.
- A guarded Git update helper, version synchronization, reproducible release ZIPs with SHA-256 checksums, and CI with tag-triggered draft releases.
- An Updates & help settings page and clearer feature-request and Buy Me a Coffee buttons.

### Improved

- Settings expose dependencies, save automatically, restore displayed values after a failed save, and reflect changes from another settings page.
- Search keeps its field reachable when the portal header becomes narrow and protects result clicks while responses arrive.
- Update Today presents scheduling, status changes, and notes in a more organized order dialog.
- README installation, updating, privacy, troubleshooting, and developer guidance; detailed behavior now has its own feature guide.

### Upgrade notes

- Existing preferences and column layouts remain in extension-local storage. New controls preserve prior behavior by default; opening results in new tabs defaults to off.
- Support desktop alerts require the `notifications` permission present in the working manifest. Review Chrome's permission prompt if upgrading from older source.
- The working manifest is **0.8.2**. These changes are not claimed as a published 0.8.2 release; maintainers must choose a release version and move this entry to a dated heading before tagging.
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
