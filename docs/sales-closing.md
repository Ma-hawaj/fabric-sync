# Branch closing and reconciliation

Open **Branch Closing**, choose a branch and any date, and compare recorded
receipts with the cash and payment totals actually held at that branch. The
initial branch uses your default issuing location when configured. Retired
branches remain available for historical checks. Dates use backend `TIMEZONE`
(default `Asia/Bahrain`). The branch and date remain in the URL.

## Opening cash and paid expenses

At the start of the branch day, count the drawer and **Save opening cash**.
Opening is separate from closing: closing cannot be saved until an opening
exists and must use the saved amount. Zero must be entered explicitly when
there is no opening float. An opening cannot be overwritten. Managers can
append a correction with a required reason; the original amount, actor and
recorded time remain in the database. Corrections invalidate prior checks.
An initial opening cannot be added after a closing check already exists.
Opening cash is required before creating **any invoice**, including retail,
fabric and gift-card sales. New invoices must have an issuing branch.

Record delivery fees and other paid expenses using **Add paid expense**. Enter
an amount, payment method and reason; payee and receipt/reference are optional.
Each expense belongs explicitly to the selected branch and business date and
has a server-recorded timestamp and authenticated staff subject. Opening must
exist first. Expenses and opening corrections are permitted only on the current,
unclosed business day. Older days' expenses cannot be added or voided, and their
existing opening amounts cannot be corrected. A missing opening can be supplied
once to complete an existing unfinished historical day; its recording time shows
when staff actually supplied it. Future days cannot be changed.

Cash expenses are paid from this drawer and reduce expected drawer cash.
Benefit/Card expenses are shown in the expense history and totals but do not
reduce merchant terminal receipt totals. Customer refunds are already recorded
separately and must not be re-entered as expenses. Bank deposits and transfers
out also have their own closing field; do not count an expense a second time
there. Expenses do not change invoice balances, sales figures or VAT snapshots.

Expense entries cannot be edited or deleted. Managers can **Void** an incorrect
entry with a reason, leaving the original expense and void attribution visible
in history. Voided expenses stop affecting expected cash. New expenses, voids
and opening corrections all change the report fingerprint and require rechecking.
Request IDs prevent unchanged retries from recording expenses twice.

## Count and check at closing

Enter other cash added, cash banked/transferred out, physically counted cash,
and confirmed net Benefit and Card receipt totals. Enter zero explicitly when
a value is zero; blank means not yet counted. Electronic receipt totals are
after customer refunds and may be negative on a day with more refunds than
receipts. The saved opening is displayed read-only.

```text
expected cash = saved opening + recorded cash receipts − cash refunds
              − recorded cash expenses + other cash added
              − cash banked/transferred out
variance = actual − expected
```

Positive variance is over; negative variance is short. Each payment method is
compared independently, so excess cash cannot hide a card shortage. Counted
amounts, opening cash and expenses accept three decimal places (Bahraini fils);
recorded invoice money retains its existing two-decimal storage precision.
Comparisons use integer fils. Gift-card tender is shown separately.

Explain cash movements and differences in the notes. Confirm that the listed
payments and refunds were handled at the selected branch, then **Save branch
check**. A check with a discrepancy can be saved for review; it is not labelled
matched. Unknown payment methods and payments on invoices without a branch are
also flagged and prevent a matched status. Unassigned payments are excluded from
branch totals and the number awaiting branch review is shown explicitly.

**Branch attribution:** the report uses the invoice's issuing branch, falling
back to its recorded collection branch only for legacy invoices without an
issuing branch. The system does not record a separate location for every
payment/refund/repair receipt. The report groups by that financial branch and explicitly asks staff to verify the handling location.
If receipts can occur at another branch, a separate transaction-location workflow
is needed before relying on this report as an automatic physical-location ledger.
The report never silently distributes invoices without a branch.

## Saved checks and exports

Checks preserve the counts, notes, method comparisons, full recorded report
snapshot, authenticated staff subject and timestamp. Rechecking appends a new
record and retains the previous records. No payment, refund or till is changed
or locked by saving a check.

## Final close and next-day opening

After saving a current check, confirm that all branch activity is recorded and
choose **Close branch day**. A final close is separate from saving a draft check.
Shortages and overages are allowed with a nonblank explanation. Unresolved
payment methods or unassigned activity also require an explanation and retain
their review status; closing never changes a discrepancy to "matched".

Final closing permanently locks that branch/day. Its report is served from the
checked snapshot, including counted amounts, notes, opening cash and expenses.
It remains available for CSV and PDF export. Rechecks, opening corrections,
expense additions and expense voids are rejected after closing. There is no
reopen or administrator bypass. Unfinished older days can still have their
counts saved and be finalized, so they cannot leave the branch permanently stuck.

Before a branch can take new orders or record financial activity, every earlier
active day must be closed and today's opening cash must be recorded explicitly.
Activity includes an invoice (even unpaid), receipt, credit, refund, gift-card
redemption, paid repair receipt, opening, expense or saved check. Completely
quiet days are skipped. The earliest unfinished active day is shown as a link.
The restriction applies separately to each branch. Closing today prevents further
financial activity at that branch until the next business day is opened.

These rules are enforced in the API transaction for invoice creation, invoice
edits, payments, paid pickups, paid repair collections, returns, cancellations,
refunds and expenses. Writes and final closing share a branch transaction lock:
a concurrent payment either makes the check stale or is rejected after closing.
Unchanged idempotent retries can return their original result after closing.
Production tracking and collections without money may continue.

Issued invoices cannot move to a different issuing branch, and invoices from
older business days cannot be rebuilt. Later receipts, returns and refunds on an
older invoice are new activity on today's open branch day; the earlier finalized
report remains fixed. Inactive branches cannot receive new orders; an adjustment
on an older invoice still follows its recorded issuing branch and day controls.

Existing databases with historical activity will need their unfinished active
days closed in date order before new sales can resume. The migration does not
invent physical cash counts or silently mark previous days as closed.

New or edited transactions change the report fingerprint and mark an older check
as requiring review. The server rechecks the fingerprint when saving and returns
409 if staff were looking at older figures. Request IDs protect retries: an
unchanged retry returns the original check; an edited retry with the same ID
conflicts. After an uncertain response, refresh and inspect the saved check.

CSV and **Print / Save PDF** include the branch, actual amounts, expected totals,
variances, notes, check reference, summary and all daily activity. Exports are
available after saving the current check and are disabled for unsaved changes,
stale checks, fetch errors and refreshes. Print uses the browser's Save as PDF.

Sales, manager and admin roles can read and save checks. Access remains
application-wide; choosing a branch does not add branch-level authorization.

## Recorded activity

`GET /api/sales-closing?branchId=<uuid>&date=YYYY-MM-DD` requires a branch and
uses the current business date when `date` is omitted. Payments, refunds,
redemptions and repair receipts use their own timestamps, even for older
invoices. Each day runs from local midnight inclusive to the next midnight
exclusive. Invoice ledgers are read in one PostgreSQL statement, without joins that
multiply payment and return amounts. Report reads use a repeatable-read
transaction so opening cash, expenses and invoice ledgers share a snapshot.

Invoice totals include discounts, VAT and gift-card sales. Credits reduce invoiced
activity; refunds reduce tender. Saved taxable amount/VAT figures on invoices
issued that day are before credits and are not a VAT adjustment calculation.
Older invoices are read-only. A finalized report always preserves what was
checked at closing, even if legacy records are subsequently changed outside the API.

`POST /api/sales-closing/checks` accepts `requestId`, `branchId`, `date`, the
current `fingerprint` and `counts` (`openingCash`, `cashAdded`, `cashRemoved`,
`actualCash`, `actualBenefit`, `actualCard`, `branchActivityConfirmed`, `notes`).
The server validates amounts and notes and computes the comparison itself.
Migration `0005_branch_closing_checks.sql` adds the append-only check records.

`POST /api/sales-closing/openings` saves `requestId`, `branchId`, `date`, `amount`
and optional `notes`. Manager-only
`POST /api/sales-closing/openings/:id/corrections` takes the same fields and
requires nonblank notes. The ID must identify the current opening revision.
`POST /api/sales-closing/expenses` takes `requestId`, `branchId`, `date`, `amount`,
`paymentType` (`cash`, `benefit`, `card`), `reason`, optional `paidTo` and
optional `reference`. Manager-only `POST /api/sales-closing/expenses/:id/void`
takes `requestId` and `reason`. These records live in additive migration
`0006_branch_openings_and_expenses.sql`.

`GET /api/sales-closing/status?branchId=<uuid>` reports today's opening,
closure, earliest previous unfinished day and whether new orders are allowed.
`POST /api/sales-closing/close` takes `requestId`, `branchId`, `date`, `checkId`
and `fingerprint`. It rejects stale or superseded checks and closes earlier days
first. Migration `0007_branch_day_closures.sql` retains final-close references,
request hashes, staff subjects and timestamps without changing existing ledgers.
