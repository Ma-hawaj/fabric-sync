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
   With daily checks enabled, an earlier opening must be closed or resolved before
   the next opening, even when that day had no sales. Follow **Close previous day**
   to finish an eligible late close first.
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

Past transactions, openings and expenses are always read-only. Staff cannot add
or correct old openings or add/void old expenses. A previous active day may have
its final closing recorded once in the late-closing window below; all other past
counts remain read-only. Future days are also read-only. Closed and skipped days
cannot be reopened or changed, including their notes and opening/expense records.
The final report uses its frozen snapshot even if data is changed outside the
application later.

While the daily trading check is enabled, new invoices and financial activity require today's saved opening
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

## First opening and missed days

There is no go-live screen or setup endpoint. The first saved opening cash entry
starts tracking for that branch. Its original business date is the permanent
cutoff, derived from the earliest original opening. Corrections, later openings,
application restarts and skipped days cannot move it. Earlier history stays
viewable, exportable and read-only without a closing backlog or fake balances.

With the daily check enabled (the default), staff must save an opening before
orders or payments. Deploy before trading begins. A new opening is rejected if
receipts, refunds, repair receipts or expenses are already recorded that day,
so current drawer cash is not counted again alongside those receipts. Existing
unpaid invoices do not prevent opening. Opening corrections still require a
manager and a reason, and are allowed only for today's unclosed day.

### Late closing before the next opening

If the evening closing was missed, staff can close the previous active day before
the branch starts today. That day must have a saved opening and be neither closed
nor skipped. Today must have no opening or trading activity, including an unpaid
new invoice, receipt, refund, redemption, paid repair receipt or expense. These
conditions apply even when the daily trading check is disabled. Quiet intervening
days do not prevent closing the last active day, but older unresolved active days
must be resolved first.

Only closing counts, cash-movement counts and an explanation can be entered;
the previous day's transactions, opening and expenses stay read-only. An explanation
is mandatory even when all amounts match. Saving marks the report **Closed late**
with its original business date, actual submission timestamp, staff and reason.
The report then locks permanently. The branch can save today's opening and trade;
closing yesterday does not close today or automatically supply today's float.

Branch locks serialize late closing with the next opening, trading and skipped-day
resolution. If today starts first, the late close is rejected without saving any
counts. Previously saved request IDs still return their original result on retry.

### Unrecoverable missed closings

If late closing is no longer possible or counts cannot be recovered, a manager can **Skip missed day**
for the earliest outstanding active day. This records a frozen snapshot, reason,
actor and time; it accepts no amount/count fields and changes no historical
figures. The report is labelled **Skipped · Unreconciled · Read-only**. The skip
cannot be edited, and closed days cannot be skipped or reopened. Skip missed
days in order, then record today's opening to resume normal controlled trading.

## Optional daily trading check

Managers can enable or disable the daily check per branch under **Branch
controls**. It defaults to enabled. Disabling it permits new orders and financial
activity without an opening amount or resolution of missed days. It does not
create an opening or move the tracking start date. Saved and historical reports
stay locked; a branch already closed today cannot accept further financial
activity even while the check is off. Final closing still requires actual counts,
a saved opening and the normal closing validations. Disabling never reopens a
closed or skipped report or extends the late-closing window.

Disabling automatically skips outstanding past active days since the first
opening. Each skip saves a frozen snapshot with an automatic reason and the
manager who disabled the check; no counts or balances are invented. It stays
**Skipped · Unreconciled · Read-only** and cannot be replaced later. Existing
closings and manual skips are preserved, and quiet days need no record.

While the check stays off, days that have since ended are automatically skipped
with the next successful financial write, opening or closing. Re-enabling also
skips any remaining past active days before restoring the requirements, so the
disabled period creates no closing backlog. This runs under the same branch lock
and transaction as the action, without a scheduled job. The current day is never
automatically skipped. Days missed after re-enabling still require manager
resolution as usual.

Enable before the day's first receipt if there is no opening yet; after receipts
have been recorded, a new opening must wait until the next business day. The
setting's latest change stores the manager and timestamp on the branch. Retrying
the same value does not overwrite that attribution or existing skip records.
The setting is separate from saved reports and cannot change their counts or
financial snapshots.

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
daily-check settings, opening corrections, expense voids and missed-closing resolutions. Access
uses the existing application role policy, without branch-specific staff scoping.

## API and storage

All endpoints are under `/api/sales-closing` and require authentication:

| Method/path | Input/purpose |
| --- | --- |
| `GET /` | `branchId`, optional `date`; returns live or frozen report and read-only status |
| `GET /status` | `branchId`; trading eligibility, new-order eligibility and blocking day |
| `PATCH /settings` | `branchId`, `required`; manager-only daily trading check switch |
| `POST /openings` | `requestId`, `branchId`, `date`, `amount`, optional `notes` |
| `POST /openings/:id/corrections` | Opening input plus required notes; appends a revision |
| `POST /expenses` | `requestId`, `branchId`, `date`, `amount`, `paymentType`, `reason`, optional `paidTo`/`reference` |
| `POST /expenses/:id/void` | `requestId`, `reason`; retains original expense |
| `POST /close` | `requestId`, `branchId`, `date`, `fingerprint`, `counts`; atomically closes today or the eligible previous active day |
| `POST /missed` | `requestId`, `branchId`, `date`, `reason`; permanent, unreconciled resolution |

`counts` contains `openingCash`, `cashAdded`, `cashRemoved`, `actualCash`,
`actualBenefit`, `actualCard`, `notes` and `branchActivityConfirmed`.
`canTrade` permits current-day financial operations; `canCreateOrders` additionally
requires an active branch. The frontend uses the former for editing an existing
invoice and the latter for creating a new one; server checks remain authoritative. Status also returns `trackingStartDate`,
`dailyCheckRequired`, `dailyCheckChangedAt`, `dailyCheckChangedBy` and
`lateClosingDate`. Reports also return the live `lateClosingDate`; when it matches
the selected date, closing counts may be submitted while `readOnly` continues to
protect recorded transactions, opening and expenses. Saved closures expose
`closure.late`, derived from their captured submission business date. Saved
financial fingerprints exclude these live eligibility fields.

Apply `0005_branch_closing.sql` after the existing baseline migrations. It adds
five tables: cash openings, expenses, expense voids, day closures and missed-closing
resolutions. The branch stores the daily-check switch and its latest actor/time. The one day-closure record contains counts,
comparison, frozen report, staff/time and retry identity. There is no check table,
check ID or draft-write endpoint. API responses expose these values together
under `closure`; open and missed days have no closing count.

This migration consolidates the feature's unmerged development migrations.
Disposable development databases that already applied those earlier versions
must be recreated; this is not an upgrade script for that intermediate schema.
Existing data on the baseline is preserved when applying the new migration.
CSV formula escaping and HTML escaping protect exported staff-entered text.
