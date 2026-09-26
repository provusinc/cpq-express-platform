# Catalog Types replace the fixed Product and Add-on kinds; Resource Role stays built in

Organizations sell things they don't call Products or Add-ons ("Services", "Materials",
"Expenses"), and Label Overrides can only rename the two fixed kinds, not add one. Product
and Add-on differed only in allowed Billing Units, so we make the kind Organization data: a
Catalog Type has a name, the Billing Units (Each, Hour or both) its items may use, a colour
and an active switch, and every Organization is seeded with Product and Add-on as ordinary,
renamable, deletable types. No code branches on a particular Catalog Type.

Resource Role is not a Catalog Type. It is the only sellable planned over time (Allocations,
the Resource Planner, capacity), so it stays a built-in kind with its own table and rules.

## Consequences

- At most 6 active Catalog Types, so each keeps a distinct, accessible chart colour beside
  labour in the Mix bar, Financials and the Timeline.
- Label Overrides no longer apply to Product and Add-on; a Catalog Type's name is its label.
- No new pricing mode: a flat fee is Each × 1, and tiered or other pricing models are out of
  scope.
