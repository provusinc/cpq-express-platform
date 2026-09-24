# Quote editing autosaves, one command per gesture, last write wins

The Salesforce version held all quote edits in local state and persisted them with one Save
button that sent a create/update/delete diff of the whole quote graph (`QuoteBatchRest`). We
replace that with autosave: each user gesture (edit a cell, add items, move a line, drag-fill
planner cells, change quote dates) is a single tRPC mutation that runs in its own transaction,
recomputes totals server-side (ADR-0002), and returns the affected rows and new Quote totals.
The UI applies it optimistically and rolls back on rejection. There is no Save button and no
unsaved state.

Concurrent editors are resolved by last write wins at field granularity — commands only touch
the fields they change — with other viewers refreshing on focus and by light polling. We
rejected per-quote version checks (too many spurious rejections during planner edits) and
real-time collaboration (v2 scope).

## Consequences

- Range edits (planner fill/drag-fill, bulk moves) must be one batched command, not N calls.
- Side-effectful changes (quote date clamp/shift, phase delete) use preview-then-apply; destructive
  commands offer a short-lived undo.
- The API surface is a set of intention-revealing commands, not a generic "save quote" endpoint.
