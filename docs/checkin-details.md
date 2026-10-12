# Extra Details

Always enabled on `/check-in`. The heading is “Extra Details,” positioned immediately above the native Additional Details block with Portal colors, inherited typography and an unboxed two-column layout. Standard and Samsung diagnosis forms receive eight extra fields: Model, Color and Device Issue text boxes; FMIP off/on; Accessories Offered and Services Offered yes/no; ETA and Price Est text boxes. Choices start unselected. ETA accepts free text, including “unsure”; the custom ETA and price do not change Portal’s native repair estimate or billing.

The MAIN-world script `extension/checkin.js` uses the current mounted native Notes textarea’s own React `onChange` handler. It appends a labeled `[UBIF Plus check-in]` section to the existing notes. Portal owns the save, diagnosis rules and work order binding. Completing normal check-in saves the combined text to the order’s `additionalDetails`, alongside all native diagnosis fields. It is visible in the native notes field before submission. No separate API writes, extension storage, or save retries occur.

Contracts checked against the public `https://portal.ubreakifix.net/assets/ubif-check-in.js` bundle on October 12, 2026:

- Standard Notes uses `data-testid="additional-details-note"`; Samsung uses `data-testid="DeviceDiagSubIssues_Notes"`. Both callbacks consume `event.target.value` and allow 2,000 characters.
- The diagnosis update is `PUT /api/checkin/workorder`; its body includes `workorderId`, `customerDeviceId`, `deviceIssues` or `deviceIssuesWithSubIssues`, `deviceDiagNotes`, and `additionalDetails`.
- No custom fields are added to native diagnosis enums. Custom details remain labeled supplemental notes.

Changing a field replaces the custom block while preserving other notes. Reopening diagnosis reads the block from Portal’s notes state. Removing the native textarea disposes the controls; a new form hydrates only from its own notes. Missing handlers, disabled/read-only notes, ambiguous forms and other routes do not write. Entries exceeding the combined Notes limit are rejected with visible feedback and the last accepted value is restored.

Automated fixtures cover both forms, all eight fields, current React handlers, notes preservation, reopening, fresh forms, limits, disabled/unsupported forms, routes, ambiguity and handler failures. An authenticated end-to-end check-in remains outstanding; no production order was created or modified during implementation.

The “Battery not working” button sits above the native diagnosis categories. It reads the current standard/Samsung accordion element props, including collapsed children, and invokes each enabled native “No issues” checkbox callback. Each callback must be confirmed in new checked props before the next category changes; checked categories are skipped. Disabled or ambiguous actions prevent activation. Failures report that native selections need review without automatic retries. Extra Details, IQC/power controls and native notes are untouched by this shortcut.
