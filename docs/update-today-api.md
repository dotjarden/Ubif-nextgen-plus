# Update Today board: API contracts and verification

Implemented against Portal's own R92.4 frontend definitions, build `03e1e12e375ef6eaa3a5`, inspected October 8, 2026. These are the same-origin APIs used by Portal, not a claim of a separately documented or supported third-party API.

Sources:
- `https://portal.ubreakifix.net/assets/ubif-repair.js?v=03e1e12e375ef6eaa3a5`
- `https://portal.ubreakifix.net/assets/ubif-util-store.js?v=03e1e12e375ef6eaa3a5`
- `https://portal.ubreakifix.net/assets/ubif-types.js?v=03e1e12e375ef6eaa3a5`
- `https://portal.ubreakifix.net/assets/ubif-components.js?v=03e1e12e375ef6eaa3a5`

## Contracts

| Action | Endpoint | Observed contract |
| --- | --- | --- |
| Active store orders | `POST /api/workorders` | One-based `page`, `pageSize`, `primaryFilter: "Active"`, `tab: "All"`, `workOrderStatusIds`, `deviceTypeIds`, `programIds`, `serviceOutcome`, `needsAttention`, `order`. Response: `workOrders`, `rowCount`. Explicit `isCrossStoreSearch: false`. |
| Current order | `GET /api/workorder/:id` | Response: `workorder`; includes `workorderId`, `workorderStatusId`, `nextUpdate`, `updatedAt`, `programId`, `CustomerDevice.customerId`. |
| Update date/time only | `PATCH /api/workorder/:id/fields` | `updateWorkorderFields` passes `{workorderId, nextUpdate}`. No status toggle. |
| Manual status override | `PATCH /api/workorder/:id/status` | `overrideWorkorderStatus`: `{workorderStatusId, nextUpdate}`; optional `isServiceBenchUpdateRequired` is omitted as in native manual override. |
| Program rules | `GET /api/program-attributes/:programId` | Object of program rules. `UseISP` disallows board status overrides. |
| Completed workflow steps | `GET /api/workorder-audit-trail/:id` | Array with `workorderStatusId`. |
| Reset completed steps after override | `PUT /api/workorder/reset-audit-trail/:id` | `{workorderId, resetWorkorderStatuses: [9,10,11,12]}` when history includes a completed step, matching manual status change. |
| Notes | `GET /api/note?workorderId=:id&offset=0&limit=50` | Response: `{notes,total}`; subsequent offsets count loaded records. |
| Add note | `POST /api/note` | `{workorderId,customerId,noteText,noteTag,noteType:2}`. Status-derived tag; native minimum is 10 non-space characters. |

Portal's native manual status UI computes a calendar maximum of today + 3 days. The board omits that UI restriction and sends an ISO timestamp. This does **not** establish that the server will accept every later date: writes surface server rejection and read the order back to check the resulting timestamp.

## Scope and behavior

- The last Workorders tab is **Update Today**, immediately after **Ready for pickup**. It preserves native table DOM and restores it when another tab is selected. SPA navigation and tab replacement are handled.
- Board queries all active orders for the current authenticated store, independently of the native table's page, filters and search. Pagination must finish before replacing the previous board.
- Default queue: overdue and today, strictly before next local midnight. Optional **Include tomorrow** includes the next local calendar day. Missing/invalid update dates are excluded and counted, not presented as due. Closed, cancelled and draft orders are excluded.
- Dates use the browser's named timezone, displayed in the board and editor; date-only values are interpreted as local dates. Users working outside their store timezone should account for that displayed timezone. There is no claimed automatic store-timezone detection.
- A two-day preset uses calendar days. An exact date/time can be entered for parts arrival. Scheduling into the future removes the card from the due queue after confirmation from Portal.
- Drag and drop stages a manual move. The user supplies the next update date/time and a reason, then saves. The same operation is available through the keyboard-accessible card editor.
- Supported direct destinations are **Need to order (2)**, **Awaiting item (3)**, **Awaiting callback (7)** and **Ready for work (8)**. These are the shared subset of native manual-override choices. From Repair summary, only Ready for work is offered. Ready for pickup and terminal orders cannot be moved back. ISP overrides are blocked after fetching program rules. Diagnostics, QC, completion, pickup, and other partner-specific steps remain native Portal workflows; no drag claims to complete them.
- A move saves status/date, resets completed workflow steps if required, and adds the user's manual note. The status endpoint owns its audit trail; the extension does not impersonate a technician with an invented automatic note.
- Board reloads every 60 seconds while visible, on focus, via Refresh, and on Portal's `workOrderUpdate` BroadcastChannel. The open editor's notes reload with the board; unsent notes are preserved. Snapshot-based saves deliberately reject stale order fields until the user explicitly refreshes the editor.
- Writes use the signed-in same-origin session. No extra permissions, tokens, external services, telemetry, local notes database, or persistent customer records.
- Status/date and notes are separate server operations, not an atomic transaction. Partial success is reported explicitly and never falsely rolled back. Unknown save outcomes disable further writes in that editor until an explicit refresh; mutations are never automatically retried. Server-side conditional writes were not found: the preflight freshness read narrows but cannot eliminate concurrent-edit races.

## Validation and remaining live checks

Automated tests and a fictional local preview exercise pagination, local day boundaries, later dates, stale records, notes escaping and order binding, direct scheduling, manual moves, audit reset, partial failures, authentication errors, uncertain writes, tab placement/restoration, SPA cleanup, drag staging, and isolation from the native column feed.

Browser preview checked: tab placement, order grouping, card editor, a manual move with a date ten days ahead and its note, and removal of the rescheduled card from the queue. Preview responses are fictional and do not prove production backend acceptance.

Before treating this as production-validated, reload extension 0.5.0 in a signed-in Portal browser and verify current response shapes/permissions, a designated order's date-only update beyond three days, an allowed manual move (including partner-side behavior), note round-trip, and native Portal refresh in another tab. No live work order was changed during implementation. Production writes and Portal's current markup still need that check.
