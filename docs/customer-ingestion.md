# Reviewing customer identities during Excel ingestion

Customers match by normalized name and phone. Case and whitespace differences
match automatically; other spellings stay separate until explicitly approved.
Sharing a phone is valid, including relatives. Similarity only sorts review
suggestions; it never merges people automatically.

Decisions are saved in `scripts/customer-decisions.json` by default. This file
is ignored by Git because it contains customer names and phone numbers.

1. Run locally, without connecting to a database:

   ```bash
   python3 scripts/ingest_xlsm.py --dry-run
   ```

   This creates the decisions file with `pending` pairs, sorted by name similarity.
   On subsequent dry runs, it preserves reviewed decisions and refreshes pending
   suggestions, including any new shared-phone names.

2. Review the file interactively:

   ```bash
   python3 scripts/review_customers.py
   ```

   The command shows the most similar unresolved names first, with one pair at
   a time. Choose `s` for the same person, `d` for different people, `k` to skip,
   `u` to undo a recent answer, or `q` to quit. Every answer is saved immediately
   to the same JSON file; stopping and restarting resumes the remaining review.
   Blank input skips a pair, keeping it pending for the next session.

   For a family phone shared by many people, choose `a` to see all unresolved
   names on that number and confirm that its remaining pairs are different.
   Previously approved aliases are preserved. This bulk action applies to the
   whole phone group, including pairs below a similarity filter.

   To focus a large review, use either option:

   ```bash
   python3 scripts/review_customers.py --min-similarity 0.8
   python3 scripts/review_customers.py --phone 33333333
   ```

   Filters only control which pairs are shown; others remain pending and stay
   separate during import. The reviewer runs locally with Python's standard
   library, without the workbook or a database connection. It supports the
   existing decisions file format, so your generated file can be used directly.
   For a custom file, pass `--customer-decisions /path/to/decisions.json`.
   You can still edit the JSON manually when needed.

3. Run `--dry-run` again to validate the decisions and preview the import.
   Copy the resulting file securely to `scripts/customer-decisions.json` in
   your production checkout, alongside the same workbook.

4. Run on production:

   ```bash
   python3 scripts/ingest_xlsm.py
   ```

Both commands automatically load the same decisions file and print its path and
SHA-256 hash, so you can verify that production uses the exact reviewed file.
Production requires the file to exist and never modifies it. Even a workbook
with no review candidates gets an empty `[]` decisions file on dry-run.

For a different location, pass `--customer-decisions /path/to/decisions.json`
on both local and production runs. Dry-run creates or refreshes that file.
Optional `--customer-review /tmp/remaining-review.json` writes a separate report
of unresolved pairs. A normal import's report includes existing database
customers; dry-run reports include workbook customers only. Report output must
be a different file from the saved decisions. These files transfer decisions,
not database records; keep them out of version control.

`same` decisions apply transitively and only within the specified phone number.
They apply consistently to invoice and measurement ownership, measurement
comparison, and legacy customer numbers. `different` decisions suppress that pair
in future review reports. `pending` entries keep people separate and continue
appearing for review. Conflicting same/different decisions are rejected before
connecting to the database.

## Measurement-sheet names take priority

Names from `Measurments` take precedence over names on `New` receipts. When the
measurement numbers on a receipt identify one customer, the invoice and its
orders use that customer. A receipt spelling variation does not create another
customer or another review question just for that receipt. A measurement row
with a name but no phone can use its linked receipt's phone.

If a receipt references multiple distinct measurement customers, its own contact
remains the invoice buyer, and each order keeps its measurement customer. This
preserves father/son records that share a phone. Receipts with no identifiable
measurement customer fall back to their own name and phone.

For saved same-person decisions, the first measurement-sheet spelling is used
for the resulting customer. An existing record matched by the normalized key or
a reviewed same-person decision gets that preferred name without changing its
ID, customer number, or history. Receipt-only names remain fallbacks.

There is no post-ingestion customer merge action. Existing separate database
records are not combined. If a saved decision would resolve multiple existing
records to one identity, ingestion stops and rolls back for reconciliation.
Existing invoice numbers and their ownership are still skipped on reruns.

## Unknown materials

The original `0001_core_schema.sql` baseline supports unknown legacy materials.
Imported orders default to `material_id = NULL`
and `material_source = 'unknown'`. No placeholder inventory record is created;
order lists and invoice documents display “Unknown material”. The quantity still
uses `--material-amount` (default 1 metre), since order quantities must be positive.
To explicitly keep the previous placeholder behavior, pass `--material General`.
Existing imported orders are skipped on reruns and retain their current material.
When editing an invoice containing unknown fabric, select the actual shop or
customer-provided material before saving.
