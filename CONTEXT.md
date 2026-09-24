# Context: CPQ Express Platform

The glossary for the standalone, multi-tenant CPQ Express (the non-Salesforce rebuild).
Terms here have a single, precise meaning across code and conversation. When code or
discussion conflicts with a definition here, that conflict is a bug — fix one or the other.

## Language

### Tenancy

**Organization**:
A customer company using CPQ Express; the unit of tenancy. Every piece of business data
(catalog, Accounts, Quotes) belongs to exactly one Organization, reached at its own subdomain.
_Avoid_: tenant, org, workspace, account (Account is a customer's customer)

**User**:
A person with one sign-in identity across all of CPQ Express, independent of any Organization.
_Avoid_: member (when you mean the person), login

**Membership**:
A User's belonging to one Organization, carrying their role there. A User may hold
Memberships in several Organizations; without one, they cannot see that Organization.
_Avoid_: seat, user-org link

**Role**:
A Membership's standing within its Organization — one of **Admin** (manages the
Organization's settings, Catalog Items and Resource Roles; may edit any Quote), **Manager** (may edit
their own Quotes and those of Members), or **Member** (may edit only their own Quotes).
_Avoid_: persona, "User" as a role name

**Approver**:
A Membership granted the right to approve or reject Quotes submitted for approval.
Independent of Role; granted by an Admin.
_Avoid_: approval queue member

**Quote Owner**:
The User who created a Quote. Fixed for the Quote's life (never transferred); together with
Role it decides who may edit, delete, submit, and recall the Quote.
_Avoid_: creator (as a separate concept), assignee

### Customers

**Account**:
A company an Organization is quoting — the Organization's customer. Every Quote is for exactly
one Account. Names are unique within an Organization. An Account with Quotes can only be
archived, never deleted.
_Avoid_: customer, client, company (ambiguous with Organization)

**Contact**:
A person at an Account. Belongs to exactly one Account; one may be the Account's primary
Contact. Quotes never reference a Contact directly — they reach Contacts only through their Account.
_Avoid_: customer contact, lead

### Catalog

**Catalog Item**:
Something an Organization sells at a list price and cost, either a **Product** or an
**Add-on**. The two differ only in billing: a Product is always priced per unit (Each); an
Add-on may be per unit or per Hour. Once used on a Quote it can only be deactivated, never deleted.
_Avoid_: SKU, catalog (for a single item)

**Resource Role**:
A kind of labour an Organization sells by the hour (e.g. "Solution Architect"), with a bill
rate, a cost rate, and a location. The only sellable whose effort is planned over time.
Like a Catalog Item, once used it can only be deactivated.
_Avoid_: rate card, resource, position

**Billing Unit**:
How a sellable's quantity is counted — Each or Hour.

**Label Override**:
An Organization's own display name for a domain term (e.g. "Consultant" for Resource Role,
"Workstream" for Phase). Changes wording only, never meaning.
_Avoid_: menu label, alias

### Quoting

**Quote**:
The top-level priced engagement offered to one Account. Owns a Quote Start Date and Quote End
Date, a Time Period, Phases, Line Items, and Milestones. Identified to people by its Name —
a required, user-chosen, non-unique label; nothing in the domain is auto-numbered.
_Avoid_: proposal, estimate, deal, quote number

**Line Item**:
A single priced row on a Quote, sourced from a Catalog Item or a Resource Role, with its own
start/end date, quantity, and a snapshot of the source's price and cost.
_Avoid_: quote line, row

**Base Rate**:
The price and cost copied from the Catalog Item or Resource Role when a Line Item is added.
Later price edits in the catalog never change it; cost edits reach it only while the Quote
is Draft (see Cost Propagation).

**Subtotal**:
The sum of a Quote's Line Item totals (unit price × quantity), before the Quote Discount.

**Quote Discount**:
A single reduction applied to a Quote's Subtotal, entered either as a percentage or as a fixed
amount; whichever was entered stays authoritative as lines change. Line Items carry no
discount of their own.
_Avoid_: line discount (not a v1 concept)

**Total**:
Subtotal minus the Quote Discount; never negative. What the customer pays.
_Avoid_: final amount, grand total

**Margin**:
Total minus the sum of Line Item costs (unit cost × quantity), also expressed as a percentage
of Total. A Line Item's own margin is shown before the Quote Discount.

**Clone**:
A new Draft Quote copied from an existing one — Phases, Line Items (with their Base Rates
unless re-snapshotted on request), Allocations, Milestones, and Quote Discount — owned by
whoever cloned it, optionally for a different Account. Never copies approval history or
Quote Documents.
_Avoid_: revision, version (Quotes have no versions)

**Cost Propagation**:
Rewriting the Base Rate cost (and resulting margins) of Draft Quotes' Line Items when a
Catalog Item's or Resource Role's cost changes. Price is never propagated. Each change is
recorded in the cost change log.

**Phase**:
A named, ordered grouping of Line Items within a Quote. Phases nest up to three levels;
a Line Item may sit in a Phase at any level, or in none. A Phase's totals and dates are
always derived from its contents.
_Avoid_: section, group, workstream (except as a Label Override)

**Milestone**:
A dated marker on a Quote's timeline — a milestone, deadline, review, or payment due.
Carries no price.
_Avoid_: event, project event

**Time Period**:
A Quote's planning granularity — Days, Weeks, Months, or Quarters. It sets the Allocation
bucket (Days and Weeks both plan by week; Months by month; Quarters by quarter) and the
default quantity of an hourly Line Item. Changing it discards the Quote's Allocations.

**Hours Per Day**:
An Organization-wide setting for how many billable hours make a working day; the basis for
converting hourly rates and effort to any Time Period.

**Quote Start Date** / **Quote End Date**:
The dates the Quote's engagement begins and is contracted to finish. User-owned — never
derived from Line Items. Moving either inward clamps Line Items to fit; moving outward
changes nothing else.
_Avoid_: "min/max line item date"

**Quote Shift**:
Moving the Quote Start Date by sliding the whole Quote — every Line Item, its Allocations,
and the Quote End Date — by the same delta, preserving all Effort. The default for a
start-date move; the alternative is clamping.

**Effort**:
The work a Line Item represents, stored as its quantity (hours or units).
_Avoid_: "hours" alone

**Allocation**:
The slice of a Resource Role Line Item's Effort that falls in one period (week, month,
or quarter).

**Resource Planner**:
The grid where hourly Resource Role Line Items' Effort is laid out period by period as
Allocations. No other Line Items appear there.

**Timeline View**:
The Gantt view of a Quote: Line Items as bars grouped by Phase, with Milestones marked.

### Lifecycle

**Quote Status**:
Where a Quote stands: Draft, Pending Approval, Approved, Rejected, Pending Customer Approval,
Customer Approved, or Customer Rejected. A Quote is **locked** (not editable) while Pending
Approval, Approved, Pending Customer Approval, or Customer Approved.

**Submission**:
The Quote Owner asking for approval of a Draft, Rejected, or Customer Rejected Quote with a
positive total; moves it to Pending Approval. Approval is mandatory before a Quote goes to
the customer.

**Recall**:
Withdrawing a Submission, returning the Quote to Draft. Done by the Quote Owner or an Admin.

**Approval Step**:
One recorded action in a Quote's approval history — submit, approve, reject, or recall —
with its actor, comment, and time. An Approver may never approve their own Quote.

**Mark as Sent**:
Declaring that an Approved Quote has gone to the customer; moves it to Pending Customer
Approval and always captures a Quote Document. The customer's answer (Customer Approved /
Customer Rejected) is then recorded by hand. Customer Approved is final; Customer Rejected
reopens the Quote for editing and resubmission.

**Quote Document**:
An immutable rendering (PDF), versioned 1, 2, 3… within its Quote, of a Quote at a point in time, kept with the snapshot
of the Quote and the document settings it was rendered from. One captured by Mark as Sent can
never be deleted.
_Avoid_: PDF version, proposal

**Valid Until**:
The last day a Quote's offer stands; after it the Valid Until has passed. Informational
only — it never changes the Quote Status. "Valid Until soon" means it falls within the
next 14 days.
_Avoid_: expires, expiry, expiring, expiration date, lapse

**Decided**:
A Quote Status in which an Approver or the customer has ruled on the Quote: Approved,
Rejected, Customer Approved, or Customer Rejected. Its margin is no longer actionable.

**Key Insight**:
A count of the Organization's Quotes that need attention, with their value: pending
approval (with the oldest wait since the latest Submission), low margin (under 15 % with a
positive Total, not Decided), Valid Until soon (Valid Until within 14 days on a Draft,
Pending Approval, Approved or Pending Customer Approval Quote) and rejected — the four
cells at the top of the Dashboard, each info, warning, or critical by its severity — plus
the high-value pipeline (Draft + Pending Approval) and this month's activity, which are
Quote list filters only. Choosing one opens the Quote list filtered to those Quotes.
_Avoid_: KPI, alert

**Dashboard**:
An Organization's landing page, kept to a glance: the open pipeline value (Quotes without a
customer outcome yet), the Key Insights that ask for action (pending approval, low margin,
Valid Until soon, rejected), the value of Quotes created per month, what needs the viewer (for
an Approver the Quotes waiting for them, for anyone else their own Quotes pending approval)
and the viewer's recent Quotes. Read-only; everything on it leads into the Quote list or the
record.
_Avoid_: home, overview, analytics

### Administration

**Platform Admin**:
A Provus staff User who operates CPQ Express itself — provisions Organizations and invites
their first admins. Sits above all Organizations; not a role within one.
_Avoid_: super admin, system admin

**Invitation**:
An offer, sent to an email address, to join one Organization with a given role. The only
way a User gains a Membership.
