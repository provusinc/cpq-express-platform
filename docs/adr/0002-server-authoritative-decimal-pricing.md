# Server-authoritative pricing in decimal arithmetic

All quote maths lives in one pure pricing package that runs in the browser (live editing) and
on the server (authoritative); on every save the server recomputes Line Item and Quote totals
and ignores any totals the client sends. The Salesforce version stored whatever the UI
computed, which made Cost Propagation, approvals, and any future threshold rules untrustworthy.

Every monetary value is stored as `numeric(19,4)` and computed with a decimal library, never JS
floats. Each Line Item total is rounded to the Organization currency's minor unit, and the
Quote total is the sum of those rounded line totals, so a Quote Document always reconciles
line by line. Percentages are `numeric(7,4)`. Each Organization has one currency; each Quote
snapshots its currency code.
