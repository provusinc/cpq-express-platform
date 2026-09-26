# Fixed Quote Stages carry the lifecycle; Organizations only name Statuses

Organizations want their own Quote Statuses ("Legal review", "Verbal yes"), but locking,
approval, Mark as Sent's captured Document, Key Insights, the Dashboard pipeline, deletion
and Cost Propagation all hang off the lifecycle. We keep six fixed Quote Stages (Draft, In
Approval, Approved, With Customer, Won, Lost) that alone carry behaviour, and let each
Organization define Statuses that each belong to one Stage and carry none. Code reasons only
about Stages; a Status is a label a Quote sits in within its Stage.

## Considered Options

- **Configurable workflow** (Organization-defined statuses, transitions and per-status flags
  such as "locks" or "needs an Approver"): rejected. It lets an Organization build workflows
  with no path to Won or states that lock and can't be left, and every rule above would have
  to be re-derived from configuration.
- **Keep the seven fixed statuses and only rename them** (Label Overrides): rejected; it gives
  no extra steps within a stage.

## Consequences

- Rejection is not a Stage: an Approver's or the customer's rejection returns the Quote to
  Draft, and "Rejected" is derived from the latest Approval Step, not from a Status.
- Moving between Statuses of one Stage is labelling, recorded as a status-change Approval
  Step; order is not enforced and approval stays one decision (multi-level approval would be
  a separate feature).
- Approval history stores the Stage and the Status name at the time, so renames and deletes
  of Statuses never rewrite history.
- Settings that were per status (deletable statuses) become per Stage.
