#!/usr/bin/env python3
"""Ingest the legacy order book (``2026 Orders.xlsm``) into fabric-sync.

Reads three sheets of the workbook (read-only, no macros executed) and loads
their data into the Postgres schema defined by ``backend/migrations/``:

  New          -> invoices + orders linked to shared measurement records
  Measurments  -> distinct measurement value sets + standalone customer history
  Repairing    -> order_repairs                (rows dated 2026 only)

Everything else in the workbook (Search, M.Pepar, Invoice, Approvel BD,
Messages, Readymade, Desion, Gift Orders) is a historical/working sheet and is
ignored — old gift card coupons are deliberately not imported.

Mapping decisions worth knowing:

 * Excel human-readable numbers are kept: ``invoices.invoice_number`` is set
   to the workbook's receipt number (identity allows explicit values; the
   sequence is advanced past the max afterwards). Orders have no number of
   their own in the source; they are identified by their invoice number.
 * Customer names come from ``Measurments`` before the ``New`` receipts.
   The last retained measurement-sheet row for a customer supplies its name,
   including when saved same-person decisions combine name variations.
   A receipt referencing exactly one identifiable measurement customer uses
   that customer for the invoice as well as the orders, so receipt spelling
   variations do not create extra customers. Consistent exact references also
   link other receipts using the same contact name and phone, even without a
   Measurement No on those receipts. A named measurement row may use
   its linked receipt's phone when its own phone is missing. Receipts with
   no usable measurement customer, or several distinct measurement customers,
   keep their own contact identity; each order still uses its own measurement
   customer when identifiable. With no measured customer on a phone, contacts
   share one customer and a saved preferred name. With one measured customer,
   its name wins for all that phone's contacts. Multiple measured identities
   sharing a phone stay separate until explicitly reviewed as the same person.
   Unmeasured contacts use one of those measured customers through exact
   references or a saved selection; they never add another customer on that phone.
   Different measured names whose Measurement Nos are 1–5 apart are classified
   as different automatically; saved same-person decisions take precedence.
   Matching normalizes names and phones (Bahrain numbers get ``+973``; names
   ignore case and extra whitespace). Saved decisions apply to reviewed aliases
   and matched existing records without changing customer numbers or ownership.
 * A customer's highest ``Measurments`` Measurement No becomes their
   ``customers.customer_number`` (6216 prints as C-6216). Numbers belong
   to the measurement's customer, even when the receipt names someone else.
   When a measurement has no identifiable owner, its receipt customer is
   used only if all its receipts agree on that customer. Other customers get
   automatic numbers above the entire workbook's measurement-number range.
   Existing customer numbers are preserved on re-runs; future app-created
   customers continue above the reserved range.
 * Every saved measurement snapshot gets its own permanent per-customer
   increment from the database, e.g. C-6216-001, C-6216-002. This
   applies to each distinct stored value set. Identical sets within one customer
   share a record across history and orders, regardless of date. Consolidation
   retains the earliest permanent ID and the latest date, redirects order and
   repair links, and retires duplicate IDs without reusing their numbers.
 * Measurement No also serves as a lookup key for order measurements. One
   order row per measurement number listed on a receipt ('6216 & 9179' ->
   two orders), each backed by a distinct or reused measurement record owned by the
   referenced ``Measurments`` row's customer (measurement wins, always —
   falling back to the invoice's customer only when the sheet row names no
   identifiable customer), with values/design copied from that row. Price
   (Final Amount) is split evenly across those
   orders, with the remainder landing on the last one so
   sum(orders.price) == total_price. A thob count larger than the listed
   measurement numbers reuses the first record (a receipt can describe several
   thobs under one measurement). A number with no sheet row, or with no
   usable values, yields no order and is counted in the report.
   ``Measurments`` rows never referenced by a 2026 receipt are still imported
   as distinct value sets under their own sheet customer —
   unless the row holds no values at all (fully empty or design-only rows
   are skipped and counted: design travels on orders, which a standalone
    row never gets).
  * Materials: sheet material names are ignored. By default orders store a
    NULL material_id and material_source='unknown', without creating inventory.
    Pass --material NAME to explicitly use a placeholder material instead.
    Legacy fabric quantities are unknown: --material-amount supplies a positive
    placeholder quantity (default 1 metre), without deducting stock.
  * Invoice money is stored exactly as charged: total_price = Final Amount,
    discount = Discount. Order prices split the final amount across the
    invoice's orders, so they are VAT-inclusive gross figures — the app's
    saved tax basis extracts 10% VAT from Final Amount (already discounted),
    rounding the taxable amount to cents and storing VAT as the remainder.
    Discount is not subtracted again (see invoices/service.rs breakdown).
  * Every payment lands in invoice_payments: the advance as one row, and for
    done receipts the remainder as a second row, so the derived status comes
    out paid. Payment types map to benefit/cash/card; the workbook's coupons,
    gifts and mixed strings map to NULL (unknown method, not a missing
    payment).
  * Cutter/Tailor/Finishing names become order_stage_assignments on the
    cutting/stitching/finishing stages (assignee_id is the name string — there is
    no user directory key for legacy staff, matching the schema's TEXT-not-FK
    choice). order_stage_progress is left empty: the workbook records who
    worked, not when each stage completed, and fabricating checklist rows would
    poison the derived stage-timing logic. In particular the sheet's Delivery
    Date is the customer receiving date, not the date the garment moved
    branches, so it feeds orders.collected_at (and the invoice target date)
    but never a 'Location delivery' completion timestamp.
 * No branch is named in the workbook. Every invoice uses one issuing/pickup branch:
   ``--branch`` if given (created when missing), else the first active
   ``receives_orders`` branch, else a created 'Main Branch'.
   Orders use the first active ``produces_orders`` branch (ordered by id), or
   ``--production-branch NAME`` to select/create a separate workshop. Missing
   production configuration is an error. Existing branches must be active and
   support the requested role; newly created branches enable only that role.
   Material stock origins remain unknown: no stock is deducted or allocated.
 * Measurement values are text in the workbook ('55 ½', '17  ¾'). Halves,
   quarters, and eighths (symbols or slash fractions) are parsed to NUMERIC
   with three decimal places; unparseable values
   (ranges, 'CANCEL', 'SHIRT', ...) become NULL and are counted in the report.
    Every measurement column has a schema home; a column that ever loses
    its mapping lands in DROPPED_MEASUREMENT and is counted instead. Two
    headers are misspelled in the sheet — Button / Button Fold hold Bottom /
    Bottom Fold values and are imported onto those columns. The sheet has no
    type/fit columns, so imported snapshots predate them and keep NULL there
    (the app requires both only on new writes).
 * The '- 2' / '- 3' design variants describe additional thobs on one
   measurement row; the schema stores one design set per order, so only the
   '- 1' set is used (extras are counted in the report).
 * A standalone measurement row is only stored when its own customer is
   identifiable — unidentifiable orphans are skipped and counted. Order
   measurements prefer the sheet row's customer but never need it: a referenced
   row without a name/phone still contributes its values under the invoice's
   customer. A receipt is skipped only when neither its measurements nor its own contact
   identifies a customer.

Idempotent: existing invoice numbers and
repair keys already in the database are skipped, so a re-run does not
duplicate (customers upsert on the canonical (name, phone) key; identical
measurement values reuse one record within that customer; an explicitly
requested placeholder material is reused when present). The
whole write happens in one transaction and rolls back
on error.

Depends on ``python3 -m pip install openpyxl psycopg2-binary``.

Run from the repository root, with DATABASE_URL exported (or --database-url):
  export DATABASE_URL=postgres://postgres:postgres@localhost:5432/fabric_sync
  python3 scripts/ingest_xlsm.py
  python3 scripts/ingest_xlsm.py --dry-run      # workbook only, no DB writes
  python3 scripts/ingest_xlsm.py --branch "Thobx Main"
  python3 scripts/ingest_xlsm.py --production-branch "Central Workshop"

Run --dry-run to refresh --customer-decisions, then review_customers.py to choose
one name per unmeasured phone and verify measured identities sharing a phone.
Required name choices block import until answered; unresolved measured identities
stay separate. One name with several phones stays separate customers, and
receipt-vs-measurement mismatches resolve to the measurement's customer. The historical
``scripts/ingest_choices.json`` file (and the removed ``--choices-file`` /
``--non-interactive`` / ``--no-save`` flags) is ignored — it can be deleted.
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import hashlib
import os
import re
import sys
import tempfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import openpyxl
import psycopg2
from psycopg2.extras import execute_values

from ingest_locations import require_branch, select_branch
from customer_identity import (CustomerIdentity, canon_key, canon_name, load_identity, norm_name,
                               norm_phone, save_review)

ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "2026 Orders.xlsm"
CUSTOMER_DECISIONS = ROOT / "scripts" / "customer-decisions.json"
PARSING_REPORT = ROOT / "scripts" / "parsing-issues.csv"
DEFAULT_MATERIAL = None
PLACEHOLDER_DATE = dt.datetime(2026, 1, 1, 0, 0, 0)
DEFAULT_BRANCH = "Main Branch"
LEGACY_VAT_RATE = Decimal("0.10")

VULGAR = {
    "⅛": Decimal("0.125"), "¼": Decimal("0.25"), "⅜": Decimal("0.375"),
    "½": Decimal("0.5"), "⅝": Decimal("0.625"), "¾": Decimal("0.75"),
    "⅞": Decimal("0.875"),
}
VULGAR_PATTERN = "[" + "".join(VULGAR) + "]"

MEASUREMENT_NUMERIC = {
    "Length - FL": "front_height",
    "Length - BL": "back_height",
    "Chest": "chest",
    "Waist": "waist",
    "Hips": "hip",
    "Shoulder": "shoulder",
    "Sleeve Length": "sleeve_length",
    "Neck": "neck_size",
    "Open Hand": "open_hand",
    "Chest Up": "chest_up",
    "Cuff Width": "cuff_width",
    "Cuffling": "cuff_size",
    "Neck Width": "neck_width",
    "Aram Hole": "armhole",
    "Fo Width": "fo_width",
    "Fo": "fo",
    "Full Body": "full_body",
    "Sleeve Haff": "sleeve_half",
    # The sheet headers misspell Bottom / Bottom Fold as Button / Button
    # Fold; the values are hem widths, so they land on the bottom columns.
    "Button": "bottom",
    "Button Fold": "bottom_fold",
    "Open Fold": "open_fold",
    "Frant Pocket Length": "front_pocket_length",
}
MEASUREMENT_TEXT = {
    "Farnt Pocket Length / Width": "front_pocket_length_by_width",
    "Mobile Pocket Length / Width": "mobile_pocket_length_by_width",
    # Sheet values are '7 * 7'-style length x width text, matching the
    # *_by_width TEXT column (the NUMERIC side_pocket sibling stays
    # NULL: the workbook never records a single side-pocket number).
    "Side Pocket": "side_pocket_length_by_width",
}
# Every workbook measurement column now has a schema home; the list stays as
# the mechanism that counts anything still without one.
DROPPED_MEASUREMENT: list[str] = []


def _is_placeholder(value: object) -> bool:
    """The bulk of measurement rows carry 2026-01-01; edits have real timestamps."""
    return isinstance(value, dt.datetime) and value == PLACEHOLDER_DATE


def parse_money(value: object) -> Decimal | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace(",", "").replace(" ", "")
    try:
        parsed = Decimal(s)
        return parsed.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if parsed.is_finite() else None
    except Exception:
        return None


def parse_measurement(value: object) -> tuple[Decimal | None, bool]:
    """Parse decimal, half/quarter/eighth symbols, and slash fractions.

    Examples: '55 ½' / '17⅜' / '55 1/2' / 32 / '¼' / '1 ¼.1'.

    Returns (parsed, ok). ok=False when the cell held content that is not a
    single measurement (a range, 'CANCEL', 'SHIRT', ...) - that is reported.
    """
    if value is None:
        return None, True
    if isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float, Decimal)):
        parsed = Decimal(str(value))
        return (parsed, True) if parsed.is_finite() else (None, False)
    s = re.sub(r"\s+", " ", str(value).strip())
    if not s:
        return None, True
    s = s.replace("⁄", "/")
    m = re.fullmatch(rf"(\d+(?:\.\d+)?)\s*({VULGAR_PATTERN})?", s)
    if m:
        total = Decimal(m.group(1))
        if m.group(2):
            total += VULGAR[m.group(2)]
        return total, True
    if s in VULGAR:
        return VULGAR[s], True
    m = re.fullmatch(r"(?:(\d+)\s+)?(\d+)\s*/\s*(\d+)", s)
    if m:
        whole, numerator, denominator = (int(part or 0) for part in m.groups())
        if denominator in (2, 4, 8) and 0 < numerator < denominator:
            return Decimal(whole) + Decimal(numerator) / Decimal(denominator), True
        return None, False
    # decimal written with a comma or a stray space: '18,5' / '7. 75'
    m = re.fullmatch(r"(\d+)[,.]\s*(\d+)", s)
    if m:
        return Decimal(f"{m.group(1)}.{m.group(2)}"), True
    # a value followed by a variant marker with a space: '15 ½ .1', '1 ½ .1'
    m = re.fullmatch(r"(.+?)\s*[.]\s*\d", s)
    if m:
        parsed, ok = parse_measurement(m.group(1))
        if ok and parsed is not None:
            return parsed, True
    # '24. ½' — decimal point used where the vulgar fraction belongs
    m = re.fullmatch(rf"(\d+)[.]\s*({VULGAR_PATTERN})", s)
    if m:
        return Decimal(m.group(1)) + VULGAR[m.group(2)], True
    m = re.fullmatch(rf"(\d+(?:\.\d+)?\s*(?:{VULGAR_PATTERN})?)\.\d", s)
    if m:
        return parse_measurement(m.group(1))[0], True
    return None, False


def customer_key(workbook, name, phone):
    identity = workbook.get("customer_identity")
    return identity.key(name, phone) if identity else canon_key(name, phone)


def apply_customer_identity(workbook, identity, state=None):
    # Rebuild from original names, not a previous automatic phone grouping.
    identity.phone_measured = None
    identity.phone_defaults = {}
    identity.measurement_links = {}
    identity.labels = {}
    workbook["customer_identity"] = identity
    if "invoices" not in workbook or "measurements" not in workbook:
        return
    for measurement in workbook["measurements"]:
        measurement["key"] = identity.base_key(measurement["name"], measurement["phone"])
    sources = {m["measurement_no"]: m for m in workbook["measurements"]}
    display, _ = customer_display(workbook, sources)
    records = []
    seen = set()

    def add_record(measurement, key):
        if key is None or (key, measurement["measurement_no"]) in seen:
            return
        seen.add((key, measurement["measurement_no"]))
        date = measurement.get("measurement_date")
        records.append({"name": display.get(key, (key[0], key[1]))[0], "phone": key[1],
                        "measurementNo": measurement["measurement_no"],
                        "date": date.isoformat() if hasattr(date, "isoformat") else str(date or ""),
                        "values": {k: str(v) for k, v in measurement.get("values", {}).items() if v is not None}})

    for measurement in workbook["measurements"]:
        if any(v is not None for v in measurement.get("values", {}).values()):
            add_record(measurement, measurement["key"])
    for invoice in workbook["invoices"]:
        for no in invoice["meas_nos"]:
            measurement = sources.get(no)
            if measurement and any(v is not None for v in measurement.get("values", {}).values()):
                key = measurement_customer_key(workbook, measurement, invoice)
                add_record(measurement, key or invoice_customer_key(workbook, invoice, sources))
    # A measured person already in the database also protects a shared phone.
    if state:
        customers = {str(cid): (name, phone) for name, phone, cid in state["customer_rows"]}
        for cid, date, values in sorted(state.get("measurement_sigs", set()), key=lambda sig: (sig[0], sig[1], str(sig[2]))):
            if cid in customers:
                name, phone = customers[cid]
                records.append({"name": name, "phone": phone, "source": "database",
                                "customerId": cid, "date": date,
                                "values": {col: value for col, value in zip(MEASUREMENT_VALUE_COLS, values)
                                           if value not in {None, "NULL", "None"}}})
    # An exact receipt reference also identifies its name/phone on other receipts.
    # Conflicting or unusable references keep that contact unresolved.
    referenced_owners = collections.defaultdict(set)
    unresolved_contacts = set()
    for invoice in workbook["invoices"]:
        contact = identity.base_key(invoice["name"], invoice["phone"])
        if contact is None:
            continue
        for no in invoice["meas_nos"]:
            measurement = sources.get(no)
            if measurement and any(v is not None for v in measurement.get("values", {}).values()):
                owner = measurement_customer_key(workbook, measurement, invoice)
                if owner:
                    referenced_owners[contact].add(owner)
                    continue
            unresolved_contacts.add(contact)
    reference_links = {contact: next(iter(owners)) for contact, owners in referenced_owners.items()
                       if len(owners) == 1 and contact not in unresolved_contacts}
    identity.configure_phones(list(display.values()), records, reference_links)
    for measurement in workbook["measurements"]:
        measurement["key"] = identity.key(measurement["name"], measurement["phone"])


def measurement_customer_key(workbook, measurement, invoice=None):
    """Use the measurement's name; a linked receipt may supply a missing phone."""
    if measurement["key"] is not None:
        return measurement["key"]
    if invoice is not None and measurement.get("name"):
        return customer_key(workbook, measurement["name"],
                            measurement.get("phone") or invoice["phone"])
    return None


def invoice_customer_key(workbook, invoice, sources):
    owners = {key for no in invoice["meas_nos"] if no in sources
              if any(v is not None for v in sources[no].get("values", {}).values())
              if (key := measurement_customer_key(workbook, sources[no], invoice)) is not None}
    if len(owners) == 1:
        return next(iter(owners))
    # A family receipt can cover several people. Never choose one arbitrarily.
    return customer_key(workbook, invoice["name"], invoice["phone"])


def customer_display(workbook, sources):
    """The last retained measurement-sheet spelling wins for each customer."""
    display = {}
    linked = collections.defaultdict(list)
    for invoice in workbook["invoices"]:
        for no in invoice["meas_nos"]:
            linked[no].append(invoice)
    source_order = {no: index for index, no in enumerate(workbook.get("measurement_source_order", []))}
    measurements = sorted(workbook["measurements"],
                          key=lambda m: source_order.get(m["measurement_no"], len(source_order)))
    for measurement in measurements:
        if measurement["key"]:
            display[measurement["key"]] = (measurement["name"], measurement["phone"])
        elif measurement.get("name"):
            for invoice in linked[measurement["measurement_no"]]:
                key = measurement_customer_key(workbook, measurement, invoice)
                if key:
                    display[key] = (measurement["name"], measurement.get("phone") or invoice["phone"])
    measurement_keys = set(display)
    for invoice in workbook["invoices"]:
        key = invoice_customer_key(workbook, invoice, sources)
        if key:
            display.setdefault(key, (invoice["name"], invoice["phone"]))
    identity = workbook.get("customer_identity")
    if identity:
        display = {key: (identity.display_name(key, name), phone)
                   for key, (name, phone) in display.items()}
        measurement_keys |= {key for key in display if key in identity.labels}
    return display, measurement_keys


def norm_payment_type(value: object) -> str | None:
    """Map a payment cell to benefit/cash/card, or NULL.

    Mixed strings ('card/benefit') take the first listed method; coupons, gifts
    and marketing entries have no schema value and become NULL.
    """
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value).strip().lower())
    if not s:
        return None
    for token in re.split(r"[/+&]", s):
        token = token.strip()
        if token in ("benefit", "card", "cash"):
            return token
    return None


def parse_measurement_numbers(value: object) -> list[int]:
    if value is None:
        return []
    return [int(x) for x in re.findall(r"\d+", str(value))]


def split_price(total: Decimal, count: int) -> list[Decimal]:
    """Split a total evenly across orders; the remainder lands on the last."""
    if count <= 1:
        return [total]
    each = (total / Decimal(count)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    parts = [each] * (count - 1)
    parts.append((total - sum(parts)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    return parts


def load_sheet_rows(wb, name: str):
    try:
        ws = wb[name]
    except KeyError:
        raise SystemExit(
            f"Sheet {name!r} not found in the workbook. "
            f"Available sheets: {', '.join(wb.sheetnames)}"
        )
    it = ws.iter_rows(values_only=True)
    try:
        header = next(it)
    except StopIteration:
        return [], {}
    header = [str(h).strip() if h is not None else None for h in header]
    index = {}
    for i, h in enumerate(header):
        if h and h not in index:
            index[h] = i
    rows = [(number, r) for number, r in enumerate(it, start=2)
            if any(v is not None for v in r)]
    return rows, index


def get(row, index: dict, name: str, default=None):
    i = index.get(name)
    if i is None or i >= len(row):
        return default
    v = row[i]
    return default if v is None else v


class Report:
    def __init__(self) -> None:
        self.numeric = collections.Counter()
        self.samples = collections.Counter()
        self.parsing_issues = []

    def count(self, key: str, n: int = 1) -> None:
        self.numeric[key] += n

    def anomaly(self, key: str, sample: object) -> None:
        self.numeric[key] += 1
        if self.numeric[key] <= 10:
            self.samples[f"{key}: {sample!r}"] += 1

    def parsing_issue(self, workbook, sheet, row_number, row, index, column, reason, action):
        """Keep every affected cell with its original Excel location and owner."""
        is_measurement = sheet == "Measurments"
        column_index = index.get(column)
        cell = (f"{openpyxl.utils.get_column_letter(column_index + 1)}{row_number}"
                if column_index is not None else "")
        self.parsing_issues.append({
            "workbook": str(Path(workbook).resolve()), "sheet": sheet,
            "row": row_number, "cell": cell, "column": column,
            "invoice_number": get(row, index, "Invoice"),
            "measurement_no": get(row, index, "Measurement No"),
            "customer_name": get(row, index, "Customer Name" if is_measurement else "Name"),
            "phone": get(row, index, "Customer Telephone" if is_measurement else "Telephone"),
            "raw_value": get(row, index, column), "issue": reason, "action": action,
        })
        self.count("parsing issues (see CSV)")

    def write_parsing_report(self, path):
        """Write an uncapped, Excel-readable CSV, replacing the old report atomically."""
        destination = Path(path)
        fields = ("workbook", "sheet", "row", "cell", "column", "invoice_number",
                  "measurement_no", "customer_name", "phone", "raw_value", "issue", "action")
        fd, temporary = tempfile.mkstemp(prefix=destination.name + ".", dir=destination.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as output:
                writer = csv.DictWriter(output, fieldnames=fields)
                writer.writeheader()
                writer.writerows(self.parsing_issues)
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def summary(self, header: str) -> str:
        lines = [f"== {header} =="]
        for key in sorted(self.numeric):
            lines.append(f"{key:44} {self.numeric[key]}")
        if self.samples:
            lines.append("-- first samples --")
            for key, n in self.samples.items():
                lines.append(f"   {n}x {key}")
        return "\n".join(lines)


# Customer matching defaults to the canonical (name, phone) pair. Reviewed
# phone-scoped aliases are applied after reading, before numbering or writing.
# Historical ingest_choices.json decisions remain ignored.


def read_workbook(path: Path, report: Report) -> dict:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

    def issue(sheet, row_number, row, index, column, reason, action):
        report.parsing_issue(path, sheet, row_number, row, index, column, reason, action)

    def money(sheet, row_number, row, index, column, action):
        raw = get(row, index, column)
        parsed = parse_money(raw)
        if parsed is None and raw is not None and str(raw).strip():
            issue(sheet, row_number, row, index, column, "Unparseable money value", action)
        return parsed

    def optional_date(sheet, row_number, row, index, column, action):
        raw = get(row, index, column)
        if raw is not None and str(raw).strip() and not isinstance(raw, dt.datetime):
            issue(sheet, row_number, row, index, column, "Unparseable date", action)
        return raw

    def measurement_numbers(sheet, row_number, row, index):
        raw = get(row, index, "Measurement No")
        numbers = parse_measurement_numbers(raw)
        if not numbers and raw is not None and str(raw).strip():
            issue(sheet, row_number, row, index, "Measurement No",
                  "No measurement numbers found", "No measurement references imported")
        return numbers

    # ---- New: invoices + orders ---------------------------------------------
    rows, idx = load_sheet_rows(wb, "New")
    invoices = []
    for row_number, r in rows:
        date = get(r, idx, "Invoice Date")
        if not isinstance(date, dt.datetime):
            report.anomaly("New: undated row skipped (shell)", r[0])
            issue("New", row_number, r, idx, "Invoice Date", "Missing or unparseable invoice date", "Row skipped")
            continue
        status = str(get(r, idx, "Status") or "").strip().lower()
        if status == "cancel":
            report.count("New: cancelled rows skipped")
            continue
        invoice = {
            "invoice_number": get(r, idx, "Invoice"),
            "invoice_date": date.date(),
            "name": norm_name(get(r, idx, "Name")),
            "phone": norm_phone(get(r, idx, "Telephone")),
            "discount": money("New", row_number, r, idx, "Discount", "Discount defaults to 0") or Decimal("0"),
            "final": money("New", row_number, r, idx, "Final Amount", "Use INCL. VAT AMT, or 0 if unavailable"),
            "advance": money("New", row_number, r, idx, "Adavance", "Advance defaults to 0") or Decimal("0"),
            "pay1": norm_payment_type(get(r, idx, "Payment Type")),
            "pay2": norm_payment_type(get(r, idx, "Payment Type 2")),
            "meas_nos": measurement_numbers("New", row_number, r, idx),
            "thobs": get(r, idx, "Thobs No"),
            # The receipt's embroidery choice, kept verbatim (case included):
            # combos like '6,TV' are legacy free text, like any uncatalogued
            # design value the app prints as-is.
            "emd": norm_name(get(r, idx, "EMD")),
            # Sheet material names are ignored entirely (see module
            # docstring): fabric is unknown unless a placeholder is requested.
            "delivery": optional_date("New", row_number, r, idx, "Delivery Date", "Value ignored as a date"),
            "approval": optional_date("New", row_number, r, idx, "Approval By Mess Date", "Value ignored as a date"),
            "status": status,
            "cutting_by": norm_name(get(r, idx, "Cutting By")),
            "tailor_by": norm_name(get(r, idx, "Tailor By")),
            "finishing_by": norm_name(get(r, idx, "Finising By")),
        }
        if invoice["invoice_number"] is None:
            report.anomaly("New: dated row without invoice number", r[0])
            issue("New", row_number, r, idx, "Invoice", "Missing invoice number", "Row skipped")
            continue
        try:
            invoice["invoice_number"] = int(invoice["invoice_number"])
        except (TypeError, ValueError, OverflowError):
            report.anomaly("New: invalid invoice number skipped",
                           invoice["invoice_number"])
            issue("New", row_number, r, idx, "Invoice", "Invalid invoice number", "Row skipped")
            continue
        if invoice["final"] is None:
            invoice["final"] = money("New", row_number, r, idx, "INCL. VAT AMT", "Final amount defaults to 0") or Decimal("0")
        invoices.append(invoice)
    report.count("New: dated rows -> invoices", len(invoices))

    # Measurement numbers referenced by 2026 receipts also serve as lookup
    # keys: order measurements take their
    # values from the referenced sheet row, and repairs resolve through the
    # receipt(s) listing the number (see meas_to_invoices).
    referenced_numbers: set[int] = set()
    meas_to_invoices: dict[int, list[int]] = {}
    for inv in invoices:
        for no in inv["meas_nos"]:
            referenced_numbers.add(no)
            meas_to_invoices.setdefault(no, []).append(inv["invoice_number"])

    # ---- Measurments: customers + measurements ------------------------------
    rows, idx = load_sheet_rows(wb, "Measurments")
    kept: dict[int, tuple] = {}
    for row_number, r in rows:
        raw_no = get(r, idx, "Measurement No")
        try:
            no = int(raw_no)
        except (TypeError, ValueError, OverflowError):
            report.anomaly("Measurments: invalid measurement number skipped", raw_no)
            issue("Measurments", row_number, r, idx, "Measurement No", "Invalid measurement number", "Row skipped")
            continue
        if no not in kept:
            kept[no] = (row_number, r)
            continue
        _, existing = kept[no]
        new_date = get(r, idx, "Date")
        old_date = get(existing, idx, "Date")
        new_real = isinstance(new_date, dt.datetime) and not _is_placeholder(new_date)
        old_real = isinstance(old_date, dt.datetime) and not _is_placeholder(old_date)
        if new_real and (not old_real or new_date > old_date):
            kept[no] = (row_number, r)
            report.count("Measurments: edit kept over placeholder")
        else:
            report.count("Measurments: duplicate number dropped")
    report.count("Measurments: kept measurement rows", len(kept))

    measurements = []
    for no, (row_number, r) in kept.items():
        name = norm_name(get(r, idx, "Customer Name"))
        phone = norm_phone(get(r, idx, "Customer Telephone"))
        values = {}
        for src, dst in MEASUREMENT_NUMERIC.items():
            parsed, ok = parse_measurement(get(r, idx, src))
            if not ok:
                report.anomaly(f"Measurments: unparseable {src}", get(r, idx, src))
                issue("Measurments", row_number, r, idx, src, "Unparseable measurement", "Value imported as NULL")
            # NUMERIC(7, 3) tops out below 10 000; a larger figure is a
            # data-entry slip (e.g. hips 45436), not a real measurement.
            if parsed is not None and abs(parsed) >= 10000:
                report.anomaly(f"Measurments: out of NUMERIC(7,3) range {src}",
                               get(r, idx, src))
                issue("Measurments", row_number, r, idx, src, "Outside NUMERIC(7,3) range", "Value imported as NULL")
                parsed = None
            values[dst] = parsed
        for src, dst in MEASUREMENT_TEXT.items():
            raw = get(r, idx, src)
            values[dst] = norm_name(raw) if raw is not None else None
        for src in DROPPED_MEASUREMENT:
            if get(r, idx, src) not in (None, "", 0):
                report.count(f"Measurments: dropped {src} (no schema home)")
        for suffix in ("2", "3"):
            for src in ("Thobe Type", "F.Pocket", "Collar", "Sleeve", "Patti",
                        "More Details"):
                if get(r, idx, f"{src} - {suffix}") not in (None, ""):
                    report.count(f"Measurments: ignored '- {suffix}' design variant")
        date = get(r, idx, "Date")
        if not isinstance(date, dt.datetime):
            optional_date("Measurments", row_number, r, idx, "Date", "Use placeholder date 2026-01-01")
            date = PLACEHOLDER_DATE
        measurements.append({
            "measurement_no": no,  # Also supplies the readable customer number.
            "name": name,
            "phone": phone,
            "key": canon_key(name, phone),
            "referenced": no in referenced_numbers,
            "measurement_date": date.date(),
            "values": values,
            "design": {
                "thobe_type": norm_name(get(r, idx, "Thobe Type - 1")),
                "f_pocket": norm_name(get(r, idx, "F.Pocket - 1")),
                "collar": norm_name(get(r, idx, "Collar - 1")),
                "sleeve": norm_name(get(r, idx, "Sleeve - 1")),
                "patti": norm_name(get(r, idx, "Patti - 1")),
                "more_details": norm_name(get(r, idx, "More Details - 1")),
            },
        })
    report.count("Measurments: storable measurement rows", len(measurements))
    report.count("Measurments: referenced by a 2026 receipt",
                 sum(1 for m in measurements if m["referenced"]))
    report.count("Measurments: unreferenced (standalone candidates)",
                 sum(1 for m in measurements if not m["referenced"]))
    report.count("Measurments: unreferenced without a customer (skipped later)",
                 sum(1 for m in measurements
                     if not m["referenced"] and m["key"] is None))

    # ---- customer verification (workbook side, no DB needed) --------------
    # One invoice = one customer, and identity is the (name, phone) pair with
    # before reviewed aliases: one phone with several names and one name with several
    # phones both stay separate customers. Everything ambiguous is reported
    # here so a human can confirm the script did not split or join wrongly.
    # Receipt-vs-measurement mismatches always resolve to the measurement's
    # customer (its phone is the one kept).
    phone_to_names: dict[str, set[str]] = {}
    name_to_phones: dict[str, set[str]] = {}
    source_by_no = {m["measurement_no"]: m for m in measurements}
    effective, _ = customer_display({"invoices": invoices, "measurements": measurements}, source_by_no)
    for name, phone in effective.values():
        phone_to_names.setdefault(phone, set()).add(name)
        name_to_phones.setdefault(name.casefold(), set()).add(phone)
    for phone, names in phone_to_names.items():
        if len(names) > 1:
            report.anomaly("customers: one phone, several names (review candidates)",
                            f"{phone} -> {sorted(names)[:4]}")
    for cname, phones in name_to_phones.items():
        if len(phones) > 1:
            report.anomaly("customers: one name, several phones (kept separate)",
                            f"{cname} -> {sorted(phones)[:4]}")
    inv_by_number = {inv["invoice_number"]: inv for inv in invoices}

    for no, inv_nos in meas_to_invoices.items():
        src = source_by_no.get(no)
        if src is None or src["key"] is None:
            continue
        for inv_no in inv_nos:
            inv = inv_by_number[inv_no]
            inv_key = canon_key(inv["name"], inv["phone"])
            if inv_key is None:
                continue
            if inv_key != src["key"]:
                report.anomaly(
                    "customers: receipt vs measurement mismatch (measurement wins)",
                    f"invoice {inv_no} ({inv['name']}/{inv['phone']})"
                    f" vs no {no} ({src['name']}/{src['phone']})",
                )

    # ---- Repairing (2026 only): order_repairs -------------------------------
    # Tolerate the misspelled sheet name ("Reparing") found in some copies of
    # the workbook; the canonical spelling wins when both exist.
    repair_sheet = "Repairing" if "Repairing" in wb.sheetnames else "Reparing"
    rows, idx = load_sheet_rows(wb, repair_sheet)
    repairs = []
    for row_number, r in rows:
        date = get(r, idx, "RECEIPT DATE")
        if not isinstance(date, dt.datetime):
            issue(repair_sheet, row_number, r, idx, "RECEIPT DATE", "Missing or unparseable receipt date", "Row skipped")
            continue
        if date.year != 2026:
            continue
        status = str(get(r, idx, "STUTES") or "").strip().lower()
        if status == "cancel":
            report.count("Repairing: cancelled rows skipped")
            continue
        repairs.append({
            "meas_nos": measurement_numbers(repair_sheet, row_number, r, idx),
            "reported_on": date.date(),
            "reason": norm_name(get(r, idx, "Problem")) or "Repair",
            "charge": money(repair_sheet, row_number, r, idx, "INCL. VAT AMT", "Repair charge defaults to 0") or Decimal("0"),
            "raw_status": status,
            "collected": optional_date(repair_sheet, row_number, r, idx, "RECEIVED     DATE", "Value ignored as a completion date"),
        })
    report.count("Repairing: 2026 rows -> repair candidates", len(repairs))

    # Gift Orders is deliberately ignored: old coupons are not imported.
    wb.close()
    return {
        "invoices": invoices,
        "measurements": measurements,
        # Naming follows retained Excel row positions without reordering history.
        "measurement_source_order": [no for no, _ in sorted(kept.items(), key=lambda item: item[1][0])],
        "repairs": repairs,
        # Workbook lookup: measurement no -> receipt
        # numbers listing it. Orders and repairs resolve through it.
        "meas_to_invoices": meas_to_invoices,
    }


MEASUREMENT_VALUE_COLS = (
    "front_height", "back_height", "chest", "waist", "hip", "shoulder",
    "sleeve_length", "neck_size", "open_hand", "chest_up", "cuff_width",
    "cuff_size", "neck_width", "armhole", "fo_width", "fo", "full_body",
    "sleeve_half", "bottom", "bottom_fold", "open_fold",
    "front_pocket_length",
    "front_pocket_length_by_width",
    "mobile_pocket_length_by_width",
    "side_pocket_length_by_width",
)


MEASUREMENT_TEXT_COLS = frozenset({
    "front_pocket_length_by_width",
    "mobile_pocket_length_by_width",
    "side_pocket_length_by_width",
})

# Include fields absent from the legacy workbook so app-created measurements
# with extra body details, type or fit are never mistaken for an exact match.
MEASUREMENT_MATCH_COLS = (*MEASUREMENT_VALUE_COLS, "shoulder_down", "side_pocket", "type", "fit")
MEASUREMENT_MATCH_TEXT_COLS = MEASUREMENT_TEXT_COLS | {"type", "fit"}


def _canon_num(value: object) -> str:
    """Scale-insensitive numeric key for measurement signatures.

    NUMERIC(7, 3) storage normalizes scale (Decimal('32') comes back as
    Decimal('32.000')) and rounds past three decimals, so compare what Postgres
    keeps: quantized to 3dp (half away from zero, as NUMERIC does), then
    scale-free.
    """
    if value is None:
        return "NULL"
    try:
        d = Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    except Exception:
        return str(value)
    d = d.normalize()
    if d == 0:
        return "0"
    return format(d, "f")


def measurement_signature(customer_id: str, measurement_date, values: dict) -> tuple:
    """Customer, date and stored values, retained for identity review context."""
    return (
        customer_id,
        measurement_date.isoformat() if hasattr(measurement_date, "isoformat") else str(measurement_date),
        measurement_values_signature(customer_id, values)[1],
    )


def measurement_values_signature(customer_id: str, values: dict) -> tuple:
    """An exact stored measurement set for one customer, independent of date."""
    return (customer_id, tuple(
        _canon_num(values.get(col)) if col not in MEASUREMENT_MATCH_TEXT_COLS else
        None if values.get(col) is None else str(values[col])
        for col in MEASUREMENT_MATCH_COLS))


def load_db_state(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT invoice_number FROM invoices")
        invoice_numbers = {row[0] for row in cur.fetchall()}
        cur.execute("SELECT name, mobile_no, id FROM customers")
        customer_rows = [(str(n), str(m), str(i)) for n, m, i in cur.fetchall()]
        cur.execute("SELECT order_id, reported_on, reason FROM order_repairs")
        repairs = {(str(a), b, c) for a, b, c in cur.fetchall()}
        cur.execute("SELECT name, id FROM order_stages")
        stages = {str(name): str(id_) for name, id_ in cur.fetchall()}
        cur.execute(
            """
            SELECT id, customer_id, measurement_date,
                front_height, back_height, chest, waist, hip, shoulder,
                sleeve_length, neck_size, open_hand, chest_up, cuff_width,
                cuff_size, neck_width, armhole, fo_width, fo, full_body,
                sleeve_half, bottom, bottom_fold, open_fold,
                front_pocket_length,
                front_pocket_length_by_width,
                mobile_pocket_length_by_width,
                side_pocket_length_by_width,
                shoulder_down, side_pocket, type, fit
            FROM measurements
            ORDER BY customer_id, measurement_number, id
            """
        )
        measurement_sigs = set()
        measurement_ids = {}
        measurement_duplicates = []
        measurement_dates = {}
        measurement_date_updates = {}
        for row in cur.fetchall():
            mid, cid, mdate = str(row[0]), str(row[1]), row[2]
            vals = dict(zip(MEASUREMENT_MATCH_COLS, row[3:]))
            measurement_sigs.add(measurement_signature(cid, mdate, vals))
            key = measurement_values_signature(cid, vals)
            if key in measurement_ids:
                measurement_duplicates.append((mid, measurement_ids[key]))
                if mdate.isoformat() > measurement_dates[key]:
                    measurement_dates[key] = mdate.isoformat()
                    measurement_date_updates[measurement_ids[key]] = mdate.isoformat()
            else:
                measurement_ids[key] = mid
                measurement_dates[key] = mdate.isoformat()
        cur.execute(
            """
            SELECT i.invoice_number, o.id
            FROM orders o JOIN invoices i ON i.id = o.invoice_id
            """
        )
        orders_by_invoice: dict[int, list[str]] = collections.defaultdict(list)
        for inv_no, order_id in cur.fetchall():
            orders_by_invoice[int(inv_no)].append(str(order_id))
    return {
        "invoice_numbers": invoice_numbers,
        "customer_rows": customer_rows,
        "repairs": repairs,
        "stages": stages,
        "measurement_sigs": measurement_sigs,
        "measurement_ids": measurement_ids,
        "measurement_duplicates": measurement_duplicates,
        "measurement_dates": measurement_dates,
        "measurement_date_updates": measurement_date_updates,
        "orders_by_invoice": orders_by_invoice,
    }


def consolidate_existing_measurements(cur, state, report):
    """Retain the earliest permanent ID and redirect exact duplicate references."""
    duplicates = state.get("measurement_duplicates", [])
    if not duplicates:
        return
    expected = {mid: key for key, mid in state["measurement_ids"].items()}
    for duplicate, keeper in duplicates:
        expected[duplicate] = expected[keeper]
    ids = [(mid,) for mid in sorted({mid for pair in duplicates for mid in pair})]
    # Lock before rewriting references, including ON DELETE SET NULL repair links.
    # Refuse a stale comparison instead of deleting a measurement edited meanwhile.
    rows = execute_values(cur, f"""
        SELECT target.id, target.customer_id, target.measurement_date,
               {', '.join('target.' + column for column in MEASUREMENT_MATCH_COLS)}
        FROM measurements AS target JOIN (VALUES %s) AS wanted(id) ON target.id = wanted.id
        ORDER BY target.id FOR UPDATE OF target
    """, ids, template="(%s::uuid)", page_size=1000, fetch=True)
    if {str(row[0]) for row in rows} != {mid for (mid,) in ids}:
        raise ValueError("Measurements changed during consolidation; rerun the import")
    for row in rows:
        mid, cid, date = str(row[0]), str(row[1]), row[2]
        key = measurement_values_signature(cid, dict(zip(MEASUREMENT_MATCH_COLS, row[3:])))
        if key != expected[mid]:
            raise ValueError("Measurements changed during consolidation; rerun the import")
        note_measurement_date(state, key, state["measurement_ids"][key], date)
    for table, column in (("orders", "measurement_id"),
                          ("order_repairs", "fixed_measurement_id")):
        execute_values(cur, f"""
            UPDATE {table} AS target SET {column} = matches.keep_id
            FROM (VALUES %s) AS matches(duplicate_id, keep_id)
            WHERE target.{column} = matches.duplicate_id
        """, duplicates, template="(%s::uuid, %s::uuid)", page_size=1000)
    deleted = execute_values(cur, """
        DELETE FROM measurements AS target
        USING (VALUES %s) AS matches(duplicate_id, keep_id)
        WHERE target.id = matches.duplicate_id
        RETURNING target.id
    """, duplicates, template="(%s::uuid, %s::uuid)", page_size=1000, fetch=True)
    report.count("measurements existing duplicates consolidated", len(deleted))


def reuse_or_insert_measurement(cur, customer_id, measurement, state, report):
    key = measurement_values_signature(customer_id, measurement["values"])
    measurement_ids = state.setdefault("measurement_ids", {})
    if key in measurement_ids:
        note_measurement_date(state, key, measurement_ids[key], measurement["measurement_date"])
        report.count("measurements identical reused")
        return measurement_ids[key]
    cur.execute(f"INSERT INTO measurements {MEASUREMENT_COLUMNS} "
                f"VALUES {MEASUREMENT_PLACEHOLDERS} RETURNING id",
                measurement_params(customer_id, measurement))
    measurement_id = str(cur.fetchone()[0])
    measurement_ids[key] = measurement_id
    state.setdefault("measurement_dates", {})[key] = measurement["measurement_date"].isoformat()
    state["measurement_sigs"].add(measurement_signature(
        customer_id, measurement["measurement_date"], measurement["values"]))
    report.count("measurements for orders created")
    return measurement_id


def note_measurement_date(state, key, measurement_id, date):
    date = date.isoformat()
    dates = state.setdefault("measurement_dates", {})
    if key not in dates or date > dates[key]:
        dates[key] = date
        state.setdefault("measurement_date_updates", {})[measurement_id] = date


def advance_measurement_dates(cur, state, report):
    updates = list(state.get("measurement_date_updates", {}).items())
    if not updates:
        return
    changed = execute_values(cur, """
        UPDATE measurements AS target SET measurement_date = matches.latest_date
        FROM (VALUES %s) AS matches(measurement_id, latest_date)
        WHERE target.id = matches.measurement_id AND target.measurement_date < matches.latest_date
        RETURNING target.id
    """, updates, template="(%s::uuid, %s::date)", page_size=1000, fetch=True)
    report.count("measurement dates advanced", len(changed))


def choose_branch(conn, branch_arg: str | None, report: Report) -> tuple[object, str]:
    return select_branch(conn, branch_arg, "receives_orders", DEFAULT_BRANCH, report)


MEASUREMENT_COLUMNS = """(
                customer_id, measurement_date,
                front_height, back_height, chest, waist, hip, shoulder,
                sleeve_length, neck_size, open_hand, chest_up, cuff_width,
                cuff_size, neck_width, armhole, fo_width, fo, full_body,
                sleeve_half, bottom, bottom_fold, open_fold,
                front_pocket_length,
                front_pocket_length_by_width,
                mobile_pocket_length_by_width,
                side_pocket_length_by_width
            )"""
MEASUREMENT_PLACEHOLDERS = """(
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )"""


def measurement_params(customer_id: str, m: dict) -> tuple:
    """Values tuple matching MEASUREMENT_COLUMNS order."""
    v = m["values"]
    return (
        customer_id,
        m["measurement_date"],
        v["front_height"],
        v["back_height"],
        v["chest"],
        v["waist"],
        v["hip"],
        v["shoulder"],
        v["sleeve_length"],
        v["neck_size"],
        v["open_hand"],
        v["chest_up"],
        v["cuff_width"],
        v["cuff_size"],
        v["neck_width"],
        v["armhole"],
        v["fo_width"],
        v["fo"],
        v["full_body"],
        v["sleeve_half"],
        v["bottom"],
        v["bottom_fold"],
        v["open_fold"],
        v["front_pocket_length"],
        v["front_pocket_length_by_width"],
        v["mobile_pocket_length_by_width"],
        v["side_pocket_length_by_width"],
    )


def has_usable_values(m: dict) -> bool:
    """Whether a sheet row contributes a measurement or design to an order."""
    if any(v is not None for v in m["values"].values()):
        return True
    return any(v is not None for v in m["design"].values())


def has_stored_values(m: dict) -> bool:
    """Whether a sheet row carries anything the measurements table can hold.

    Design-only rows count as empty for standalone purposes: design travels
    on orders, which a standalone row never gets, so importing one would
    store a customer + date with every value NULL.
    """
    return any(v is not None for v in m["values"].values())


def report_measurement_consolidation(workbook, report):
    """Preview distinct stored sets without connecting to the database."""
    signatures = set()
    candidates = 0

    def include(owner, measurement):
        nonlocal candidates
        if owner:
            candidates += 1
            signatures.add(measurement_values_signature(owner, measurement["values"]))

    for measurement in workbook["measurements"]:
        if not measurement["referenced"] and has_stored_values(measurement):
            include(measurement["key"], measurement)
    sources = {m["measurement_no"]: m for m in workbook["measurements"]}
    invoices_seen = set()
    for invoice in workbook["invoices"]:
        if invoice["invoice_number"] in invoices_seen:
            continue
        invoices_seen.add(invoice["invoice_number"])
        owner = invoice_customer_key(workbook, invoice, sources)
        if not owner:
            continue
        for number in invoice["meas_nos"]:
            measurement = sources.get(number)
            if measurement and has_usable_values(measurement):
                include(measurement_customer_key(workbook, measurement, invoice) or owner, measurement)
    report.count("measurement sets after consolidation", len(signatures))
    report.count("duplicate measurement records consolidated", candidates - len(signatures))


def legacy_customer_numbers(workbook: dict, report: Report) -> tuple[dict, int]:
    """Highest legacy Measurement No per canonical customer, plus reserved max.

    Reserve every valid source/reference number, including unused, orphaned,
    and older measurements, before allocating numbers to unmapped customers.
    """
    if "customer_identity" not in workbook:
        apply_customer_identity(workbook, CustomerIdentity([], canon_key))
    sources = {m["measurement_no"]: m for m in workbook["measurements"]}
    receipt_owners: dict[int, set[tuple[str, str]]] = collections.defaultdict(set)
    reserved = set()
    for inv in workbook["invoices"]:
        key = invoice_customer_key(workbook, inv, sources)
        for no in inv["meas_nos"]:
            if 0 < no < 9223372036854775807:
                reserved.add(no)
                if key:
                    receipt_owners[no].add(key)

    candidates: dict[tuple[str, str], set[int]] = collections.defaultdict(set)
    for measurement in workbook["measurements"]:
        no = measurement["measurement_no"]
        if not 0 < no < 9223372036854775807:
            report.anomaly("customers: invalid legacy number (automatic ID used)", no)
            continue
        reserved.add(no)
        key = measurement["key"]
        if key is None:
            owners = receipt_owners[no]
            if len(owners) != 1:
                if owners:
                    report.anomaly("customers: shared ownerless measurement (automatic IDs used)", no)
                continue
            key = next(iter(owners))
        candidates[key].add(no)

    numbers = {key: max(values) for key, values in candidates.items()}
    for key, values in candidates.items():
        if len(values) > 1:
            report.anomaly("customers: highest measurement number selected",
                           f"{key}: {sorted(values)} -> C-{numbers[key]}")
    report.count("customers with legacy measurement numbers", len(numbers))
    return numbers, max(reserved, default=0)


def perform_insert(conn, workbook: dict, branch_id: str, report: Report,
                   material_name: str | None = DEFAULT_MATERIAL,
                   material_amount: Decimal = Decimal("1"),
                   production_branch_id: object | None = None) -> None:
    if (not material_amount.is_finite() or material_amount <= 0
            or material_amount > Decimal("99999999.99")
            or material_amount != material_amount.quantize(Decimal("0.01"))):
        raise ValueError("material amount must be positive with at most two decimal places")
    state = load_db_state(conn)
    identity = workbook.get("customer_identity") or CustomerIdentity([], canon_key)
    apply_customer_identity(workbook, identity, state)
    if identity.name_questions:
        raise ValueError("Choose a customer name for each unmeasured phone group using review_customers.py before importing")
    # Never silently choose between existing records after adding an alias.
    existing = {}
    for name, phone, customer_id in state["customer_rows"]:
        key = customer_key(workbook, name, phone)
        if key and key in existing and existing[key] != customer_id:
            raise ValueError(
                f"Multiple existing customers resolve to {key}; reconcile those records before importing")
        if key:
            existing[key] = customer_id
    _, issuing_branch_name = require_branch(conn, branch_id, "receives_orders")
    if production_branch_id is None:
        production_branch_id, _ = select_branch(conn, None, "produces_orders", None, report)
    else:
        require_branch(conn, production_branch_id, "produces_orders")
    legacy_numbers, reserved_max = legacy_customer_numbers(workbook, report)
    with conn.cursor() as cur:
        consolidate_existing_measurements(cur, state, report)
        measurement_ids = state.setdefault("measurement_ids", {})
        # Legacy fabric is unknown by default; a placeholder is opt-in.
        placeholder_material_id = None
        if material_name is not None:
            cur.execute("SELECT id FROM materials WHERE name = %s LIMIT 1",
                        (material_name,))
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "INSERT INTO materials (name, unit) VALUES (%s, 'meters') RETURNING id",
                    (material_name,),
                )
                placeholder_material_id = str(cur.fetchone()[0])
                report.count(f"materials created: {material_name}")
            else:
                placeholder_material_id = str(row[0])
                report.count(f"materials reused: {material_name}")

        # Measurement-sheet names take precedence over linked receipt names.
        source_by_no = {m["measurement_no"]: m for m in workbook["measurements"]}
        display, measurement_keys = customer_display(workbook, source_by_no)
        db_customers: dict[tuple[str, str], str] = {}
        for name, mobile, id_ in state["customer_rows"]:
            key = customer_key(workbook, name, mobile)
            if key is None:
                continue
            if key not in db_customers:
                db_customers[key] = id_
            else:
                report.count("customers already merged in DB (same canonical key)")
        new_customers = {k: v for k, v in display.items() if k not in db_customers}
        existing_names = {customer_id: name for name, _, customer_id in state["customer_rows"]}
        for key in sorted(measurement_keys & db_customers.keys()):
            name, _ = display[key]
            customer_id = db_customers[key]
            if existing_names[customer_id] != name:
                cur.execute("UPDATE customers SET name=%s WHERE id=%s", (name, customer_id))
                report.count("customer names updated from measurement sheet")
        # Move above all workbook numbers before automatic inserts. Never
        # rewind a sequence already advanced by an earlier import/app write.
        cur.execute(
            """
            WITH bounds AS (
                SELECT GREATEST(
                    COALESCE(MAX(customer_number), 0),
                    COALESCE(pg_sequence_last_value(
                        pg_get_serial_sequence('customers', 'customer_number')::regclass
                    ), 0), %s
                ) AS high FROM customers
            )
            SELECT setval(pg_get_serial_sequence('customers', 'customer_number'),
                          GREATEST(high, 1), high > 0) FROM bounds
            """,
            (reserved_max,),
        )
        cur.execute("SELECT customer_number FROM customers")
        taken_numbers = {row[0] for row in cur.fetchall()}
        for key, (name, phone) in new_customers.items():
            number = legacy_numbers.get(key)
            if number is not None and number in taken_numbers:
                report.anomaly("customers: legacy number already in use (automatic ID used)",
                               f"{key} -> {number}")
                number = None
            if number is None:
                cur.execute(
                    "INSERT INTO customers (name, mobile_no) VALUES (%s, %s) "
                    "ON CONFLICT (name, mobile_no) DO NOTHING",
                    (name, phone),
                )
                report.count("customers assigned automatic numbers")
            else:
                cur.execute(
                    "INSERT INTO customers (name, mobile_no, customer_number) "
                    "OVERRIDING SYSTEM VALUE VALUES (%s, %s, %s) "
                    "ON CONFLICT (name, mobile_no) DO NOTHING",
                    (name, phone, number),
                )
                taken_numbers.add(number)
                report.count("customers assigned legacy measurement numbers")
        report.count("customers created", len(new_customers))
        cur.execute("SELECT name, mobile_no, id FROM customers")
        customer_ids: dict[tuple[str, str], str] = {}
        for n, m, id_ in cur.fetchall():
            key = customer_key(workbook, str(n), str(m))
            if key and key not in customer_ids:
                customer_ids[key] = str(id_)

        # ---- measurements ---------------------------------------------------
        # Standalone history and order references share the same exact-value index.
        standalone_to_add = {}
        for m in workbook["measurements"]:
            if m["referenced"]:
                continue
            if not has_stored_values(m):
                report.count("measurements empty skipped (no values to store)")
                continue
            if m["key"] is None:
                report.count("measurements orphan skipped (no customer, unreferenced)")
                continue
            akey = m["key"]
            if akey not in customer_ids:
                report.anomaly("measurements orphan skipped (no customer, unreferenced)",
                               m["measurement_no"])
                continue
            key = measurement_values_signature(customer_ids[akey], m["values"])
            if key in measurement_ids:
                note_measurement_date(state, key, measurement_ids[key], m["measurement_date"])
                report.count("measurements identical reused")
                continue
            parameters = measurement_params(customer_ids[akey], m)
            if key in standalone_to_add:
                report.count("measurements identical reused")
                if parameters[1] > standalone_to_add[key][1]:
                    standalone_to_add[key] = parameters
            else:
                standalone_to_add[key] = parameters
        if standalone_to_add:
            rows = execute_values(cur,
                f"INSERT INTO measurements {MEASUREMENT_COLUMNS} VALUES %s "
                f"RETURNING id, customer_id, measurement_date, {', '.join(MEASUREMENT_VALUE_COLS)}",
                list(standalone_to_add.values()), page_size=1000, fetch=True)
            for row in rows:
                mid, cid, date = str(row[0]), str(row[1]), row[2]
                values = dict(zip(MEASUREMENT_VALUE_COLS, row[3:]))
                key = measurement_values_signature(cid, values)
                measurement_ids[key] = mid
                state.setdefault("measurement_dates", {})[key] = date.isoformat()
                state["measurement_sigs"].add(measurement_signature(cid, date, values))
        report.count("measurements standalone created", len(standalone_to_add))

        # ---- invoices + orders ----------------------------------------------
        stage_ids = state["stages"]
        made_stages = {("cutting", "cutting_by"), ("stitching", "tailor_by"),
                       ("finishing", "finishing_by")}

        # Orders resolve through receipts, so this also serves repairs on a
        # re-run: number -> receipt(s) -> orders, all without a stored key.
        order_by_invoice: dict[int, list[str]] = collections.defaultdict(list)
        for inv_no, order_ids in state["orders_by_invoice"].items():
            order_by_invoice[inv_no].extend(order_ids)
        steps = 0
        for inv in workbook["invoices"]:
            if inv["invoice_number"] in state["invoice_numbers"]:
                report.count("invoices already present (skipped)")
                continue
            inv_key = invoice_customer_key(workbook, inv, source_by_no)
            if inv_key is None or inv_key not in customer_ids:
                report.anomaly("invoices skipped (no identifiable customer)",
                               inv["invoice_number"])
                continue
            total = inv["final"]
            # Final Amount is the VAT-inclusive amount already charged.
            taxable_amount = (total / (1 + LEGACY_VAT_RATE)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP)
            vat_amount = total - taxable_amount
            delivery = inv["delivery"]
            target_date = (
                delivery.date()
                if isinstance(delivery, dt.datetime)
                else delivery
                if isinstance(delivery, dt.date)
                else inv["invoice_date"]
            )
            cur.execute(
                """
                INSERT INTO invoices (
                    invoice_number, created_at, total_price, invoice_date, target_date, branch_id,
                    discount, discount_unit, customer_id, gift_card_redeemed,
                    issuing_branch_id, issuing_branch_name, vat_rate, taxable_amount, vat_amount
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'amount', %s, 0, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    inv["invoice_number"],
                    dt.datetime.combine(inv["invoice_date"], dt.time()),
                    total,
                    inv["invoice_date"],
                    target_date,
                    branch_id,
                    inv["discount"],
                    customer_ids[inv_key],
                    branch_id,
                    issuing_branch_name,
                    LEGACY_VAT_RATE,
                    taxable_amount,
                    vat_amount,
                ),
            )
            invoice_id = cur.fetchone()[0]
            state["invoice_numbers"].add(inv["invoice_number"])
            report.count("invoices created")

            # The ledger is the source of truth for payment status: the
            # advance as one row, and for done receipts the remainder as a
            # second row so the invoice derives as paid. Methods may be NULL
            # (unknown), which the schema allows.
            if inv["advance"] > 0:
                cur.execute(
                    """
                    INSERT INTO invoice_payments (invoice_id, order_id, amount, payment_type)
                    VALUES (%s, NULL, %s, %s)
                    """,
                    (invoice_id, inv["advance"], inv["pay1"]),
                )
            if inv["status"] == "done":
                remainder = total - (inv["advance"] or Decimal("0"))
                if remainder > 0:
                    cur.execute(
                        """
                        INSERT INTO invoice_payments (invoice_id, order_id, amount, payment_type)
                        VALUES (%s, NULL, %s, %s)
                        """,
                        (invoice_id, remainder, inv["pay2"] or inv["pay1"]),
                    )

            if not inv["meas_nos"]:
                report.count("invoices left without orders (no measurement)")
                continue
            # Every listed number still produces an order. Identical value sets
            # reuse a snapshot owned by the measurement row's customer.
            # Only a referenced row without an identifiable customer falls
            # back to the receipt owner (its values still contribute).
            copies: list[tuple] = []  # (measurement_id, source row)
            for no in inv["meas_nos"]:
                src = source_by_no.get(no)
                if src is None:
                    report.anomaly(
                        "orders skipped (measurement no has no sheet row)", no)
                    continue
                if not has_usable_values(src):
                    report.anomaly(
                        "orders skipped (measurement row has no usable values)", no)
                    continue
                owner_key = inv_key
                src_key = measurement_customer_key(workbook, src, inv)
                if src_key is not None and src_key in customer_ids:
                    owner_key = src_key
                    report.count("orders owned by measurement customer")
                else:
                    report.anomaly(
                        "orders kept receipt owner (measurement owner unknown)",
                        no)
                measurement_id = reuse_or_insert_measurement(cur, customer_ids[owner_key], src, state, report)
                copies.append((measurement_id, src))
            if not copies:
                report.count("invoices left without orders (no usable measurements)")
                continue
            thobs = inv["thobs"]
            if isinstance(thobs, (int, float)) and int(thobs) > len(copies):
                fills = int(thobs) - len(copies)
                copies.extend([copies[0]] * fills)
                report.count("orders reusing first measurement (thobs > nos)", fills)
            prices = split_price(total, len(copies))
            collected_at = None
            if inv["status"] == "done":
                for d in (inv["delivery"], inv["approval"]):
                    if isinstance(d, dt.datetime):
                        collected_at = d
                        break
            for k, (measurement_id, src) in enumerate(copies):
                design = src["design"]
                material_id = placeholder_material_id
                cur.execute(
                    """
                    INSERT INTO orders (
                        measurement_id, material_id, material_amount, invoice_id, price, material_source,
                        thobe_type, f_pocket, collar, sleeve, patti, emd, more_details,
                        status, collected_at, production_branch_id, material_stock_branch_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
                    RETURNING id
                    """,
                    (
                        measurement_id,
                        material_id,
                        material_amount,
                        invoice_id,
                        prices[k],
                        "shop" if material_id is not None else "unknown",
                        design.get("thobe_type"),
                        design.get("f_pocket"),
                        design.get("collar"),
                        design.get("sleeve"),
                        design.get("patti"),
                        inv["emd"],
                        design.get("more_details"),
                        "collected" if inv["status"] == "done" else "pending",
                        collected_at,
                        production_branch_id,
                    ),
                )
                order_id = cur.fetchone()[0]
                order_by_invoice[inv["invoice_number"]].append(str(order_id))
                report.count("orders created")

                # Staff assignment on the cutting/stitching/finishing stages.
                for stage_name, attr in made_stages:
                    stage_id = stage_ids.get(stage_name)
                    person = inv[attr]
                    if stage_id and person:
                        cur.execute(
                            """
                            INSERT INTO order_stage_assignments
                                (order_id, stage_id, assignee_id, assignee_name)
                            VALUES (%s, %s, %s, %s)
                            ON CONFLICT (order_id, stage_id) DO NOTHING
                            """,
                            (order_id, stage_id, person, person),
                        )
                # The sheet's Delivery Date is the receiving date, not a stage
                # completion date (see module docstring): it already feeds
                # collected_at above, and no progress row is fabricated for it.
                steps += 1
        report.count("invoices+orders roundtrips", steps)
        advance_measurement_dates(cur, state, report)

        # Advance the identity sequence so the app's next invoice can't collide.
        cur.execute(
            "SELECT setval(pg_get_serial_sequence('invoices', 'invoice_number'),"
            " (SELECT MAX(invoice_number) FROM invoices))"
        )

        # ---- repairs --------------------------------------------------------
        # Repairs still use the workbook lookup: number -> receipt(s) listing
        # it in this workbook -> orders on those receipts (created above or
        # already in the DB from an earlier run).
        meas_to_invoices = workbook["meas_to_invoices"]
        repair_status = {"done": "completed", "ready": "in_progress"}
        repair_rows = []
        for rep in workbook["repairs"]:
            if not rep["meas_nos"]:
                report.count("repairs skipped (no measurement no)")
                continue
            candidates: list[str] = []
            candidate_invoices: set[int] = set()
            for inv_no in meas_to_invoices.get(rep["meas_nos"][0], []):
                for order_id in order_by_invoice.get(inv_no, []):
                    candidates.append(order_id)
                    candidate_invoices.add(inv_no)
            if not candidates:
                report.count("repairs skipped (measurement has no order)")
                continue
            if len(candidate_invoices) > 1:
                report.anomaly("repairs ambiguous (several receipts, first taken)",
                               rep["meas_nos"][0])
            order_id = candidates[0]
            if (order_id, rep["reported_on"], rep["reason"]) in state["repairs"]:
                report.count("repairs already present (skipped)")
                continue
            completed_at = None
            if isinstance(rep["collected"], dt.datetime):
                completed_at = rep["collected"]
            repair_rows.append((
                order_id,
                rep["reason"],
                rep["reported_on"],
                rep["charge"],
                repair_status.get(rep["raw_status"], "open"),
                completed_at,
            ))
        cur.executemany(
            """
            INSERT INTO order_repairs
                (order_id, reason, reported_on, charge, status, completed_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            repair_rows,
        )
        report.count("repairs created", len(repair_rows))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", default=str(WORKBOOK),
                        help="path to the workbook (default: repo root)")
    parser.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    parser.add_argument("--branch", default=None,
                        help="issuing/pickup branch name (must receive orders; created if missing)")
    parser.add_argument("--production-branch", default=None,
                        help="production branch name (created if missing; "
                             "default: first active branch that produces orders)")
    parser.add_argument("--material", default=DEFAULT_MATERIAL,
                        help="optional placeholder material (default: NULL/unknown; sheet names ignored)")
    parser.add_argument("--material-amount", type=Decimal, default=Decimal("1"),
                        help="positive placeholder metres per legacy order (default: 1)")
    parser.add_argument("--dry-run", action="store_true",
                        help="read the workbook only; no database access (review output is allowed)")
    parser.add_argument("--customer-decisions", default=str(CUSTOMER_DECISIONS),
                        help="saved JSON decisions (default: scripts/customer-decisions.json; "
                             "created/refreshed by dry-run, required for import)")
    parser.add_argument("--customer-review", help="write customer questions and automatic separation evidence as JSON")
    parser.add_argument("--parsing-report", default=str(PARSING_REPORT),
                        help="CSV of every parsing issue with Excel locations (default: scripts/parsing-issues.csv)")
    args = parser.parse_args()
    protected_paths = [args.workbook, args.customer_decisions, args.customer_review]
    if any(Path(args.parsing_report).resolve() == Path(path).resolve()
           for path in protected_paths if path):
        parser.error("Parsing report must differ from the workbook and customer decision/review files")
    if (args.customer_decisions and args.customer_review
            and Path(args.customer_decisions).resolve() == Path(args.customer_review).resolve()):
        parser.error("Customer review output must differ from the decisions file")
    try:
        decisions_path = Path(args.customer_decisions)
        if not decisions_path.exists() and not args.dry_run:
            parser.error("Customer decisions file missing; run --dry-run locally and copy "
                         "the reviewed file to production, or pass --customer-decisions")
        identity = load_identity(decisions_path if decisions_path.exists() else None, canon_key)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))

    report = Report()
    workbook = read_workbook(Path(args.workbook), report)
    report.write_parsing_report(args.parsing_report)
    affected_rows = {(row["sheet"], row["row"]) for row in report.parsing_issues}
    print(f"Parsing report: {Path(args.parsing_report).resolve()} "
          f"({len(report.parsing_issues)} issues in {len(affected_rows)} rows)")
    apply_customer_identity(workbook, identity)
    sources = {m["measurement_no"]: m for m in workbook["measurements"]}
    identities = list(customer_display(workbook, sources)[0].values())
    if args.dry_run:
        save_review(decisions_path, identity, identities)
    digest = hashlib.sha256(decisions_path.read_bytes()).hexdigest()
    print(f"Customer decisions: {decisions_path.resolve()} (SHA-256: {digest})")
    if args.customer_review:
        Path(args.customer_review).write_text(json.dumps(identity.review(identities), indent=2, ensure_ascii=False) + "\n")
    if args.dry_run:
        legacy_customer_numbers(workbook, report)
        report_measurement_consolidation(workbook, report)
    questions = identity.review(identities)
    report.count("customer names to choose", len(identity.name_questions))
    report.count("measured customer pairs to verify", sum(row["decision"] == "pending" for row in questions))
    report.count("measured pairs automatically different", sum(row["decision"] == "different" for row in questions))
    report.count("receipt contacts linked by Measurement No", len(identity.measurement_links))
    print(report.summary("workbook"))

    if args.dry_run:
        print("Dry-run complete — no database writes performed.")
        return 0

    url = args.database_url or os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL must be set (or pass --database-url)", file=sys.stderr)
        return 2

    conn = psycopg2.connect(url)
    conn.autocommit = False
    try:
        state = load_db_state(conn)
        apply_customer_identity(workbook, identity, state)
        if args.customer_review:
            identities.extend((n, p) for n, p, _ in state["customer_rows"])
            Path(args.customer_review).write_text(json.dumps(identity.review(identities), indent=2, ensure_ascii=False) + "\n")
        if identity.name_questions:
            print("Choose the pending customer names with scripts/review_customers.py before importing.", file=sys.stderr)
            conn.rollback()
            return 2
        branch_id, branch_label = choose_branch(conn, args.branch, report)
        production_id, production_label = select_branch(
            conn, args.production_branch, "produces_orders", None, report)
        print(f"Issuing/pickup branch: {branch_label}")
        print(f"Production branch: {production_label}")
        perform_insert(conn, workbook, branch_id, report,
                       material_name=args.material, material_amount=args.material_amount,
                       production_branch_id=production_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(report.summary("committed"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
