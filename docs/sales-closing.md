# Branch closing and reconciliation

Open **Branch Closing**, select a branch and any date. The page compares recorded
receipts with physically counted cash and independently confirmed net Benefit and
Card totals. The initial selection uses the default issuing location when set.
Retired branches remain available for history. Dates use backend `TIMEZONE`
(default `Asia/Bahrain`); branch and date are retained in the URL.

## Daily workflow

1. Count the drawer and **Save opening cash** before the first sale or payment.
   Enter zero explicitly when there is no float. The opening cannot be overwritten;
   managers can append a correction with a reason on the current, unclosed day.
2. Use **Add paid expense** for delivery fees and other payments. Supply an amount,
   payment method and reason; payee and receipt reference are optional. Managers
   can void mistakes with a reason. Original entries and their attribution remain.
3. Enter physically counted cash, confirmed net Benefit/Card receipts, other cash
   added and cash banked/transferred out. Blank means uncounted; enter zero where
   appropriate. Explain differences and cash movements, confirm that activity was
   handled at this branch and is complete, then **Review and close day**.

Closing saves the counts, comparisons, notes, recorded report snapshot, staff
identity and final branch/day lock in one record. There is no separate draft
save. Counts and notes stay in the form when activity refreshes; confirmation is
cleared so staff review the updated comparison. Navigating away loses an unclosed
form. Once closed, the report is permanently read-only and available for CSV or
print/Save as PDF. Historical reports can also be exported without invented counts.

```text
expected cash = saved opening + recorded cash receipts − cash refunds
              − cash expenses + other cash added − cash banked/transferred out
variance = actual − expected
```

Each payment method is compared independently. Positive variance is over;
negative variance is short. Explained differences are allowed at closing and
remain visible. Unknown methods and unassigned activity require an explanation
and prevent a matched status even after closing. Comparisons use integer fils;
counts, openings and expenses accept three decimals. Invoice money retains its
existing two-decimal storage precision. Electronic net receipts may be negative
when customer refunds exceed receipts. Gift-card tender is shown separately.

Cash expenses reduce expected drawer cash. Benefit/Card expenses are outgoing
business payments and do not reduce merchant receipt totals. Do not enter customer
refunds again as expenses or count expenses again as cash banked. Expenses do not
change invoice balances, sales or saved VAT figures.

## Permanent locks and branch controls

Every past report is read-only, including unfinished days. Staff cannot add old
openings or physical counts, correct old openings, add or void old expenses, or
perform an ordinary close for an old day. Future days are also read-only. Closed
days cannot be reopened or changed, including their notes and opening/expense
records. The final report uses its frozen snapshot even if data is changed outside
the application later.

After go-live, new invoices and financial activity require today's saved opening
and no unresolved earlier active day. Activity includes an invoice, payment,
return/refund, redemption, paid repair receipt, opening or expense; quiet days are
skipped. A final close blocks further financial activity until the next business
day. Controls are independent per branch. Free collections and production tracking
can continue. Existing invoice rebuilds are restricted to the current business
day and cannot move the financial branch; later payments/adjustments belong to
the current open day.

Branch transaction locks serialize closing with invoices, payments, paid
collections, repair receipts, returns, cancellations, refunds and expenses.
The server compares the report fingerprint while holding the lock. A concurrent
payment either changes the fingerprint and rejects closing, or is rejected after
closing. Invalid/stale closing requests create neither counts nor a final lock.
Unchanged retries use the original request ID and return their saved result;
changed requests with that ID conflict. After an uncertain response, refresh:
a committed close appears read-only; otherwise review and retry the same values.

## First rollout and missed closings

**Manager actions** contains setup and missed-closing forms, outside the daily
workflow. A manager sets one immutable go-live date per branch. Until setup, new
financial activity is blocked. If trading has started today, choose a future
date so the first controlled opening can be counted before trading. Before that
scheduled date, existing trading continues normally. From go-live, opening and
daily closure rules apply. Restarts cannot shift the cutoff.

History before go-live remains viewable, exportable and read-only without a
closing backlog or fake counts. The migration does not create go-live dates,
opening balances or closing reports; managers configure the start date explicitly.

If staff miss a closing after go-live, a manager can resolve the earliest
outstanding active day with a separate explanation. This records a frozen snapshot,
reason, actor and time; it accepts no amount/count fields and changes no historical
figures. The day is labelled **Missed closing resolved — unreconciled**, never
matched or normally closed. The resolution is permanent and cannot be edited.
Already-closed days cannot be resolved or reopened. Resolve missed days in order,
then record today's opening to resume trading.

## Financial ownership and access

Reports use the invoice's issuing branch, falling back to its recorded pickup
branch only for legacy invoices without an issuer. Pickup changes cannot move
financial history. Payments, refunds and repair receipts have no separate physical
handling location, so staff must verify the listed activity was handled here.
Supporting receipts at other branches requires a separate transaction-location
workflow. Branchless invoices remain excluded and flagged; assigning them a branch
retroactively would change historical totals, so ordinary edits cannot do this.
A separate audited recovery design is needed for their outstanding balances.

Invoice taxable/VAT values use saved snapshots, including current gift-card
accounting. This operational report is not a VAT return. Sales, manager and admin
roles can view reports, open, record expenses and close; manager/admin roles own
setup, opening corrections, expense voids and missed-closing resolutions. Access
uses the existing application role policy, without branch-specific staff scoping.

## API and storage

All endpoints are under `/api/sales-closing` and require authentication:

| Method/path | Input/purpose |
| --- | --- |
| `GET /` | `branchId`, optional `date`; returns live or frozen report and read-only status |
| `GET /status` | `branchId`; trading eligibility, new-order eligibility and blocking day |
| `POST /setup` | `requestId`, `branchId`, `startsOn`; immutable go-live date |
| `POST /openings` | `requestId`, `branchId`, `date`, `amount`, optional `notes` |
| `POST /openings/:id/corrections` | Opening input plus required notes; appends a revision |
| `POST /expenses` | `requestId`, `branchId`, `date`, `amount`, `paymentType`, `reason`, optional `paidTo`/`reference` |
| `POST /expenses/:id/void` | `requestId`, `reason`; retains original expense |
| `POST /close` | `requestId`, `branchId`, `date`, `fingerprint`, `counts`; atomically saves and locks today |
| `POST /missed` | `requestId`, `branchId`, `date`, `reason`; permanent, unreconciled resolution |

`counts` contains `openingCash`, `cashAdded`, `cashRemoved`, `actualCash`,
`actualBenefit`, `actualCard`, `notes` and `branchActivityConfirmed`.
`canTrade` permits current-day financial operations; `canCreateOrders` additionally
requires an active branch. The frontend uses the former for editing an existing
invoice and the latter for creating a new one; server checks remain authoritative.

Apply `0005_branch_closing.sql` after the existing baseline migrations. It adds
six tables: cash openings, expenses, expense voids, closing policies, day closures
and missed-closing resolutions. The one day-closure record contains counts,
comparison, frozen report, staff/time and retry identity. There is no check table,
check ID or draft-write endpoint. API responses expose these values together
under `closure`; open and missed days have no closing count.

This migration consolidates the feature's unmerged development migrations.
Disposable development databases that already applied those earlier versions
must be recreated; this is not an upgrade script for that intermediate schema.
Existing data on the baseline is preserved when applying the new migration.
CSV formula escaping and HTML escaping protect exported staff-entered text.
