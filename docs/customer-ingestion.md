# Reviewing customer identities during Excel ingestion

Ingestion groups customers by normalized phone, using measurements to decide
which names need identity verification:

| Measured identities on a phone | Import behavior | Review needed |
| --- | --- | --- |
| None | All names share one customer. | Choose one display name if there are several names. |
| One | All contacts use the measured customer and its measurement-sheet name. | None. |
| Several | Measured customers stay separate; contacts without measurements must use one of them. | Choose the measured owner for unmeasured contacts. Measurement Nos 1–5 apart mean different people automatically; verify other identity pairs. |

Repeated snapshots under the same normalized name and phone count as one
identity. Case and whitespace differences match automatically. Blank or
design-only Excel rows do not count as measurements. Existing database
customers with saved measurement snapshots also count during import, including
when their measurements are absent from the current workbook.

When several measured customers share a phone, contacts without measurements
must be assigned to one of those measured customers, even if there is only one
unmeasured contact. Exact Measurement No references are used first, including
reusing a proven link on other receipts with the same contact name and phone.
Only contacts without a usable, unambiguous link need a selection. The prompt
lists the receipt-only names as context and offers
only measured customers as numbered options. Custom names and extra customers
without measurements are unavailable on that phone. This selection never combines
two measured customers. Similarity sorts identity suggestions and never merges people.

Automatic contact grouping applies to identities present in the workbook.
An existing app customer absent from the workbook keeps their own identity,
even if an imported contact shares their phone. Explicit saved aliases still
apply; if they combine two existing customer records, import stops for reconciliation.

Older mixed-option questions are restricted to measured choices by the reviewer.
An old answer choosing an unmeasured name is reopened when measurements are
available, and import stops until a valid measured customer is selected. With no
measurements on the phone, choosing an existing or custom contact name still works.

Two distinct measured names on the same phone are automatically considered
different when any Measurement No from one profile is 1–5 away from a number
on the other profile. For example, 100 and 105 mean different customers; 100
and 106 still need review. Compare the workbook's `Measurement No`, using the
absolute difference. Saved same/different answers take precedence over this rule.

Automatic decisions are saved as `different` with `rule: "measurement_number_gap"`,
the two source numbers and their difference. They are refreshed from current
measurements on every dry-run, so changed source numbers do not leave stale
automatic answers. Human answers remain saved. The reviewer can also apply the
rule from measurement details already saved in an older review file.

Equal Measurement Nos follow the existing duplicate-row selection. Repeated
measurements under the same normalized name and phone remain one identity.
Missing source numbers, including database-only snapshots without an Excel
Measurement No, do not trigger the rule. Neither measurement values nor the
app's per-customer snapshot numbers are used for the comparison.

Decisions are saved in `scripts/customer-decisions.json` by default. This file
is ignored by Git because it contains customer names, phones and measurement
details. Name choices are saved per phone; identity decisions are saved per
name pair and phone, so they survive workbook updates.

1. Run locally, without connecting to a database:

   ```bash
   python3 scripts/ingest_xlsm.py --dry-run
   ```

   This creates or refreshes the decisions file with one `name_pending` question
   per unmeasured phone needing a name, plus automatic `different` entries and
   remaining `pending` pairs for measured identities sharing a phone. Rerun
   this once for an older, large review file
   to replace receipt-only pair comparisons with a single name choice per phone.
   Previously answered decisions are preserved. New receipt spellings on a
   phone with a saved name choice reuse that choice; new measured identities
   produce new comparisons as needed.

2. Review the file interactively:

   ```bash
   python3 scripts/review_customers.py
   ```

   When measurements exist, select a listed measured customer number. If the
   phone has no measurements, enter a listed name number or `n` for a custom name.
   Pairs with Measurement Nos 1–5 apart are saved as different automatically.
   For the remaining measured identities, choose `s` for the same person or
   `d` for different people. The reviewer shows recent measurement values for
   both names; `v` shows every available snapshot and value. Choose `k` to skip, `u` to undo a
   recent answer, or `q` to quit. Every answer is saved immediately, so stopping
   and restarting resumes the remaining review. Blank input skips a question.

   For a family phone shared by many measured people, choose `a` to see all
   unresolved names on that number and confirm its remaining pairs are different.
   Previously approved aliases are preserved. This bulk action applies to the
   whole phone group, including pairs below a similarity filter.

   To focus a large review, use either option:

   ```bash
   python3 scripts/review_customers.py --min-similarity 0.8
   python3 scripts/review_customers.py --phone 33333333
   ```

   The phone filter applies to both kinds of question. The similarity filter
   only applies to identity comparisons; required name choices remain visible.
   Skipped measured pairs remain separate during import. Unanswered required
   name choices or measured-owner selections stop the import before writes.

   The reviewer runs with Python's standard library, without the workbook or
   a database connection. It also supports the previous pair-only JSON format;
   refresh it with `--dry-run` to get the new grouping rules and measurement
   context. For a custom file, pass `--customer-decisions /path/to/decisions.json`.
   You can still edit the JSON manually when needed.

3. Run `--dry-run` again to validate the decisions and preview the import.
   Copy the resulting file securely to `scripts/customer-decisions.json` in
   your production checkout, alongside the same workbook.

4. Run on production:

   ```bash
   python3 scripts/ingest_xlsm.py
   ```

Both commands load the same decisions file and print its path and SHA-256 hash,
so you can verify production uses the exact reviewed file. Production requires
the file to exist and never modifies it. A workbook with no review candidates
gets an empty `[]` decisions file on dry-run.

For a different location, pass `--customer-decisions /path/to/decisions.json`
on both local and production runs. Optional `--customer-review /tmp/review.json`
writes a separate report of pending name choices, measured identity pairs and
automatic separation evidence.
A normal import's report includes existing database measurements; dry-run
reports include workbook measurements only. Report output must differ from the
saved decisions file. These files transfer decisions, not database records;
keep them out of version control.

`same` decisions apply transitively within the specified phone. They apply to
invoice and measurement ownership, measurement comparison, and legacy customer
numbers. Human `different` decisions suppress future identity comparisons for
that pair; rule-generated decisions are recomputed from current measurements.
`pending` measured identities stay separate. A `name` choice saves the measured
customer selected for receipt-only contacts, or a preferred display name when
that phone has no measurements. If measurement data is added later, one measured
identity is used automatically; several require a valid measured selection. Conflicting
same/different decisions or conflicting preferred names are rejected before
connecting to the database. Old receipt-only same/different answers are retained
for future measurement comparisons; unmeasured contacts follow phone grouping.

## Measurement-sheet names take priority

Names from `Measurments` take precedence over names on `New` receipts when
actual measurement values exist. When a receipt's referenced measurements
identify one customer, the invoice and its orders use that customer. A receipt
spelling variation does not create another customer or another review question.
A measurement row with a name but no phone can use its linked receipt's phone.

When all known Measurement No references for a receipt name and phone point to
one measured customer on that phone, other receipts using that contact also use
that customer, even if their own Measurement No is empty. Two receipt spellings
on a shared family phone can therefore link to two different measured people.
Conflicting owners, family receipts referencing several owners, or non-empty
references without a usable source row prevent this reuse and keep the contact
for review. The match is based on exact references; number proximity never
links customers. Existing measured identities are not reassigned by this rule.

These links are recomputed from the workbook on dry-run and import. Saved manual
decisions continue to transfer to production; the same workbook yields the same
reference links. A saved phone-wide owner choice applies to the contacts still
unresolved after this matching. The summary counts contacts linked by Measurement No.

If a receipt references several distinct measured customers, its contact is
the invoice buyer under the phone-grouping rules above, and each order keeps
its measurement customer. This preserves father/son records sharing a phone.
Receipts with no identifiable measurement customer use their own contact under
the same rules.

The last retained measurement-sheet row for each customer supplies its name,
including when saved same-person decisions combine name variations. “Last”
means Excel row order; measurement numbers and dates do not rank the names.
Duplicate Measurement Nos still use the existing row-selection policy, then
the retained rows' original positions determine name priority. Linked receipts
can supply missing phones, and their order does not change which name wins.
An existing matched record gets that preferred name, or the chosen unmeasured
contact name, without changing its ID, customer number, or history.

These rules group incoming workbook entries. There is no post-ingestion merge
action, and existing separate database records are not consolidated. If grouping
would resolve multiple existing records to one identity, ingestion stops and
rolls back for reconciliation. Existing invoice numbers and their ownership
are skipped on reruns.

## Consolidating identical measurements

Ingestion stores one measurement record per customer and exact value set.
Measurement dates and Excel Measurement Nos do not make identical values
distinct. All stored measurement fields must match, including pocket text,
type, fit, and body fields absent from the workbook. Numbers compare at the
database's three-decimal precision; text and NULL remain distinct.

Standalone history and orders use the same records. Every receipt and order
still exists, with its own price, design and other order details. Two customers
with identical measurements keep separate records, including relatives sharing
a phone. Customer identity review still uses the original source numbers before
measurement storage is consolidated.

Existing duplicates are consolidated during import too. The earliest permanent
measurement ID and number survive, and the stored date becomes the latest date
seen for that value set. Orders and repair fixes are redirected to the survivor
before duplicate rows are removed. Retired numbers are never reused. This keeps
the latest value set current even when a customer later returns to earlier values.
The operation shares the import transaction and rolls back on an error.

Dry-run shows the workbook's projected distinct-set and duplicate counts without
accessing a database. Normal import also reports existing duplicates consolidated,
matching records reused, and dates advanced. The original schema already supports
shared measurement references; no additional migration is required.

## Finding records with parsing issues

Every workbook read writes `scripts/parsing-issues.csv` and prints its path,
issue count and affected-row count. Generate it locally without a database:

```bash
python3 scripts/ingest_xlsm.py --dry-run
```

Open the CSV in Excel or another spreadsheet tool. Each entry identifies the
source workbook, sheet, original Excel row and cell, column, invoice number,
measurement number, customer name and phone when available. It includes the
original cell value, the issue, and the import behavior, such as importing a
measurement as NULL, using a fallback amount/date, or skipping the row. Several
bad cells on one record produce several entries. All issues are included;
the ten-sample console limit does not apply to this file.

The report covers invalid invoice/measurement numbers, unusable measurement
references, unparseable or out-of-range measurement values, invalid amounts,
missing required dates and invalid non-empty optional dates. Measurement-value
checks apply to the selected row when duplicate measurement numbers exist.
Intentional exclusions, such as cancelled rows or repairs outside 2026, are not
parsing issues; ordinary empty optional cells are also omitted.

Correct the indicated cells in the original workbook, save it, then rerun
`--dry-run`. Each run replaces the report, so fixed issues disappear; a clean
run writes a header-only CSV. Customer decisions remain in their separate file
and are reused. The report is generated before database writes and is ignored
by Git because it contains customer data. To choose another output location:

```bash
python3 scripts/ingest_xlsm.py --dry-run --parsing-report /tmp/parsing-issues.csv
```

## Unknown materials

The original `0001_core_schema.sql` baseline supports unknown legacy materials.
Imported orders default to `material_id = NULL`
and `material_source = 'unknown'`. No placeholder inventory record is created;
order lists and invoice documents display “Unknown material”. The quantity still
uses `--material-amount` (default 1 metre), since order quantities must be positive.
To explicitly keep the previous placeholder behavior, pass `--material General`.
Existing imported orders are skipped on reruns and retain their current material.
Invoice edits retain unknown fabric and its recorded price when the pricing
inputs stay the same. Notes, measurements, production location and delivery
details can be updated without selecting a material or allocating stock. Choose
the actual shop or customer-provided material before changing fabric quantity,
design choices or urgency, since those changes require current pricing.
