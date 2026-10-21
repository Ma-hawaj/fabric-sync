#!/usr/bin/env python3
"""Ingest the legacy order book (``2026 Orders.xlsm``) into fabric-sync.

Reads three sheets of the workbook (read-only, no macros executed) and loads
their data into the Postgres schema defined by
``backend/migrations/20260712000000_create_tables.sql``:

  New          -> invoices + orders (+ per-order measurement copies)
  Measurments  -> value source for the copies + standalone customer history
  Repairing    -> order_repairs                (rows dated 2026 only)

Everything else in the workbook (Search, M.Pepar, Invoice, Approvel BD,
Messages, Readymade, Desion, Gift Orders) is a historical/working sheet and is
ignored — old gift card coupons are deliberately not imported.

Mapping decisions worth knowing:

 * Excel human-readable numbers are kept: ``invoices.invoice_number`` is set
   to the workbook's receipt number (identity allows explicit values; the
   sequence is advanced past the max afterwards). Orders have no number of
   their own in the source; they are identified by their invoice number.
 * One invoice has exactly one customer — the Name/Telephone on its ``New``
   receipt row. Customer identity is the canonical ``(name, phone)`` pair:
   the normalized phone (8-digit Bahrain numbers stored with the default
   ``+973`` prefix) plus the name collapsed for whitespace and case
   (``canon_key``). Spelling variants such as 'Ali' vs 'ALI' merge via
   casefolding; anything else always stays separate — genuinely different
   names sharing one phone (family/shared numbers) are separate customers,
   and one name with different numbers is separate customers too. Both cases
   are listed in the report for manual review but never merged. When the
   receipt and the referenced ``Measurments`` row name different customers,
   the measurement's customer always owns the order's copy (its phone is the
   one kept).
 * Measurement No is a transient lookup key only and is never stored. One
   order row per measurement number listed on a receipt ('6216 & 9179' ->
   two orders), each backed by a fresh measurement snapshot owned by the
   referenced ``Measurments`` row's customer (measurement wins, always —
   falling back to the invoice's customer only when the sheet row names no
   identifiable customer), with values/design copied from that row. Price
   (Final Amount) is split evenly across those
   orders, with the remainder landing on the last one so
   sum(orders.price) == total_price. A thob count larger than the listed
   measurement numbers reuses the first copy (a receipt can describe several
   thobs under one measurement). A number with no sheet row, or with no
   usable values, yields no order and is counted in the report.
   ``Measurments`` rows never referenced by a 2026 receipt are still imported
   once each under their own sheet customer, so customer history is kept —
   unless the row holds no values at all (fully empty or design-only rows
   are skipped and counted: design travels on orders, which a standalone
    row never gets).
  * Materials: sheet material names are ignored entirely — neither the
    ``New`` receipt cell nor ``Measurments`` ``Materail`` is read. Every
    order points at one placeholder ``materials`` row (``--material``,
    default ``'General'``), created when missing. Fabric identity for
    legacy orders is therefore not preserved; re-run against a DB that
    already holds sheet-named materials leaves those rows untouched.
  * Invoice money is stored exactly as charged: total_price = Final Amount,
    discount = Discount. Order prices split the final amount across the
    invoice's orders, so they are VAT-inclusive gross figures — the app's
    breakdown extracts VAT from the discounted gross, which matches how the
    workbook charged it (see invoices/service.rs breakdown).
  * Every payment lands in invoice_payments: the advance as one row, and for
    done receipts the remainder as a second row, so the derived status comes
    out paid. Payment types map to benefit/cash/card; the workbook's coupons,
    gifts and mixed strings map to NULL (unknown method, not a missing
    payment).
  * Cutter/Tailor/Finishing names become order_stage_assignments on the
    Cutting/Sewing/Finishing stages (assignee_id is the name string — there is
    no user directory key for legacy staff, matching the schema's TEXT-not-FK
    choice). order_stage_progress is left empty: the workbook records who
    worked, not when each stage completed, and fabricating checklist rows would
    poison the derived stage-timing logic. In particular the sheet's Delivery
    Date is the customer receiving date, not the date the garment moved
    branches, so it feeds orders.collected_at (and the invoice target date)
    but never a 'Location delivery' completion timestamp.
 * No branch is named in the workbook. Every invoice uses one branch:
   ``--branch`` if given (created when missing), else the first active
   ``receives_orders`` branch, else a created 'Main Branch'.
 * Measurement values are text in the workbook ('55 ½', '17  ¾'). They are
   parsed to NUMERIC where the schema has a numeric column; unparseable values
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
   identifiable — unidentifiable orphans are skipped and counted. Per-order
   copies prefer the sheet row's customer but never need it: a referenced
   row without a name/phone still contributes its values under the invoice's
   customer. A receipt with no identifiable customer is skipped as a whole.

Idempotent: existing invoice numbers and
repair keys already in the database are skipped, so a re-run does not
duplicate (customers upsert on the canonical (name, phone) key; standalone
measurements are skipped when the same customer already holds an identical
date + value set; the placeholder material is reused when present). The
whole write happens in one transaction and rolls back
on error.

Depends on ``python3 -m pip install openpyxl psycopg2-binary``.

Run from the repository root, with DATABASE_URL exported (or --database-url):
  export DATABASE_URL=postgres://postgres:postgres@localhost:5432/fabric_sync
  python3 scripts/ingest_xlsm.py
  python3 scripts/ingest_xlsm.py --dry-run      # workbook only, no DB writes
  python3 scripts/ingest_xlsm.py --branch "Thobx Main"

Ambiguous customer identities are never merged and never prompt: one phone
with several name spellings stays separate customers, one name with several
phones stays separate customers, and receipt-vs-measurement customer
mismatches always resolve to the measurement's customer. The historical
``scripts/ingest_choices.json`` file (and the removed ``--choices-file`` /
``--non-interactive`` / ``--no-save`` flags) is ignored — it can be deleted.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import os
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import openpyxl
import psycopg2

ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "2026 Orders.xlsm"
DEFAULT_MATERIAL = "General"
PLACEHOLDER_DATE = dt.datetime(2026, 1, 1, 0, 0, 0)
DEFAULT_BRANCH = "Main Branch"

VULGAR = {"½": Decimal("0.5"), "¼": Decimal("0.25"), "¾": Decimal("0.75")}

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
    if isinstance(value, Decimal):
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if isinstance(value, (int, float)):
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    s = str(value).strip()
    if not s:
        return None
    s = s.replace(",", "").replace(" ", "")
    try:
        return Decimal(s).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return None


def parse_measurement(value: object) -> tuple[Decimal | None, bool]:
    """Parse '55 ½' / '17  ¾' / 32 / '¼' / '1 ¼.1'.

    Returns (parsed, ok). ok=False when the cell held content that is not a
    single measurement (a range, 'CANCEL', 'SHIRT', ...) - that is reported.
    """
    if value is None:
        return None, True
    if isinstance(value, (int, float)):
        if float(value) != float(value):  # NaN
            return None, False
        return Decimal(str(value)), True
    s = re.sub(r"\s+", " ", str(value).strip())
    if not s:
        return None, True
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(½|¼|¾)?", s)
    if m:
        total = Decimal(m.group(1))
        if m.group(2):
            total += VULGAR[m.group(2)]
        return total, True
    if s in VULGAR:
        return VULGAR[s], True
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
    m = re.fullmatch(r"(\d+)[.]\s*(½|¼|¾)", s)
    if m:
        return Decimal(m.group(1)) + VULGAR[m.group(2)], True
    m = re.fullmatch(r"(\d+(?:\.\d+)?\s*(?:½|¼|¾)?)\.\d", s)
    if m:
        return parse_measurement(m.group(1))[0], True
    return None, False


def norm_name(value: object) -> str | None:
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value).strip())
    return s or None


def norm_phone(value: object) -> str | None:
    """Normalize a workbook phone number to the stored ``mobile_no`` form.

    Bahrain local numbers are 8 digits; they are stored with the default
    ``+973`` prefix (``33332963`` -> ``+97333332963``). Numbers already
    carrying the 973 country code collapse to the same ``+973...`` form, and
    other international numbers keep an explicit ``+`` when the cell had one.
    """
    if value is None:
        return None
    had_plus = False
    if isinstance(value, (int, float)):
        digits = str(int(value))
    else:
        s = str(value).strip()
        if not s:
            return None
        had_plus = s.startswith("+")
        digits = re.sub(r"\D", "", s)
    if not digits:
        return None
    if len(digits) == 8:
        return f"+973{digits}"
    if digits.startswith("973") and len(digits) == 11:
        return f"+{digits}"
    if had_plus:
        return f"+{digits}"
    return digits


def canon_name(value: object) -> str | None:
    """Whitespace-collapsed, casefolded name for customer matching.

    Display spelling ('Ali' vs 'ALI') must not split one customer, so every
    identity check uses this; the first-seen display form is what gets stored.
    """
    name = norm_name(value)
    return name.casefold() if name else None


def canon_key(name_value: object, phone_value: object) -> tuple[str, str] | None:
    """Canonical customer identity, or None when unidentifiable.

    Accepts raw cell values or already-normalized strings — both helpers are
    idempotent, so callers don't need to care which they hold.
    """
    name = canon_name(name_value)
    phone = norm_phone(phone_value)
    if not (name and phone):
        return None
    return (name, phone)


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
    rows = [r for r in it if any(v is not None for v in r)]
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

    def count(self, key: str, n: int = 1) -> None:
        self.numeric[key] += n

    def anomaly(self, key: str, sample: object) -> None:
        self.numeric[key] += 1
        if self.numeric[key] <= 10:
            self.samples[f"{key}: {sample!r}"] += 1

    def summary(self, header: str) -> str:
        lines = [f"== {header} =="]
        for key in sorted(self.numeric):
            lines.append(f"{key:44} {self.numeric[key]}")
        if self.samples:
            lines.append("-- first samples --")
            for key, n in self.samples.items():
                lines.append(f"   {n}x {key}")
        return "\n".join(lines)


# ---- customer-identity policy (no merging, no prompts) ----------------------
# Customer identity is the canonical (name, phone) pair, full stop:
#  * one phone with several name spellings -> separate customers, always;
#  * one name with several phones          -> separate customers, always;
#  * receipt vs measurement naming different customers -> the measurement's
#    customer owns the order's copy (its phone is the one kept), always.
# There is no interactive merging and no choices file: an earlier version of
# this script asked and persisted answers in scripts/ingest_choices.json;
# that file is now ignored and can be deleted.


def read_workbook(path: Path, report: Report) -> dict:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

    # ---- New: invoices + orders ---------------------------------------------
    rows, idx = load_sheet_rows(wb, "New")
    invoices = []
    for r in rows:
        date = get(r, idx, "Invoice Date")
        if not isinstance(date, dt.datetime):
            report.anomaly("New: undated row skipped (shell)", r[0])
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
            "discount": parse_money(get(r, idx, "Discount")) or Decimal("0"),
            "final": parse_money(get(r, idx, "Final Amount")),
            "advance": parse_money(get(r, idx, "Adavance")) or Decimal("0"),
            "pay1": norm_payment_type(get(r, idx, "Payment Type")),
            "pay2": norm_payment_type(get(r, idx, "Payment Type 2")),
            "meas_nos": parse_measurement_numbers(get(r, idx, "Measurement No")),
            "thobs": get(r, idx, "Thobs No"),
            # The receipt's embroidery choice, kept verbatim (case included):
            # combos like '6,TV' are legacy free text, like any uncatalogued
            # design value the app prints as-is.
            "emd": norm_name(get(r, idx, "EMD")),
            # Sheet material names are ignored entirely (see module
            # docstring): every order points at the placeholder material.
            "delivery": get(r, idx, "Delivery Date"),
            "approval": get(r, idx, "Approval By Mess Date"),
            "status": status,
            "cutting_by": norm_name(get(r, idx, "Cutting By")),
            "tailor_by": norm_name(get(r, idx, "Tailor By")),
            "finishing_by": norm_name(get(r, idx, "Finising By")),
        }
        if invoice["invoice_number"] is None:
            report.anomaly("New: dated row without invoice number", r[0])
            continue
        try:
            invoice["invoice_number"] = int(invoice["invoice_number"])
        except (TypeError, ValueError, OverflowError):
            report.anomaly("New: invalid invoice number skipped",
                           invoice["invoice_number"])
            continue
        if invoice["final"] is None:
            invoice["final"] = parse_money(get(r, idx, "INCL. VAT AMT")) or Decimal("0")
        invoices.append(invoice)
    report.count("New: dated rows -> invoices", len(invoices))

    # Measurement numbers referenced by 2026 receipts. The numbers are a
    # transient lookup key only (never stored): per-order copies take their
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
    for r in rows:
        raw_no = get(r, idx, "Measurement No")
        try:
            no = int(raw_no)
        except (TypeError, ValueError, OverflowError):
            report.anomaly("Measurments: invalid measurement number skipped", raw_no)
            continue
        if no not in kept:
            kept[no] = r
            continue
        existing = kept[no]
        new_date = get(r, idx, "Date")
        old_date = get(existing, idx, "Date")
        new_real = isinstance(new_date, dt.datetime) and not _is_placeholder(new_date)
        old_real = isinstance(old_date, dt.datetime) and not _is_placeholder(old_date)
        if new_real and (not old_real or new_date > old_date):
            kept[no] = r
            report.count("Measurments: edit kept over placeholder")
        else:
            report.count("Measurments: duplicate number dropped")
    report.count("Measurments: kept measurement rows", len(kept))

    measurements = []
    for no, r in kept.items():
        name = norm_name(get(r, idx, "Customer Name"))
        phone = norm_phone(get(r, idx, "Customer Telephone"))
        values = {}
        for src, dst in MEASUREMENT_NUMERIC.items():
            parsed, ok = parse_measurement(get(r, idx, src))
            if not ok:
                report.anomaly(f"Measurments: unparseable {src}", get(r, idx, src))
            # NUMERIC(6, 2) tops out below 10 000; a larger figure is a
            # data-entry slip (e.g. hips 45436), not a real measurement.
            if parsed is not None and abs(parsed) >= 10000:
                report.anomaly(f"Measurments: out of NUMERIC(6,2) range {src}",
                               get(r, idx, src))
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
            date = PLACEHOLDER_DATE
        measurements.append({
            "measurement_no": no,  # transient join key only, never stored
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
    # no merging, ever: one phone with several names and one name with several
    # phones both stay separate customers. Everything ambiguous is reported
    # here so a human can confirm the script did not split or join wrongly.
    # Receipt-vs-measurement mismatches always resolve to the measurement's
    # customer (its phone is the one kept).
    phone_to_names: dict[str, set[str]] = {}
    name_to_phones: dict[str, set[str]] = {}
    for inv in invoices:
        if inv["name"] and inv["phone"]:
            phone_to_names.setdefault(inv["phone"], set()).add(inv["name"])
            name_to_phones.setdefault(inv["name"].casefold(), set()).add(inv["phone"])
    for m in measurements:
        if m["name"] and m["phone"]:
            phone_to_names.setdefault(m["phone"], set()).add(m["name"])
            name_to_phones.setdefault(m["name"].casefold(), set()).add(m["phone"])
    for phone, names in phone_to_names.items():
        if len(names) > 1:
            report.anomaly("customers: one phone, several names (kept separate)",
                            f"{phone} -> {sorted(names)[:4]}")
    for cname, phones in name_to_phones.items():
        if len(phones) > 1:
            report.anomaly("customers: one name, several phones (kept separate)",
                            f"{cname} -> {sorted(phones)[:4]}")
    inv_by_number = {inv["invoice_number"]: inv for inv in invoices}
    source_by_no = {m["measurement_no"]: m for m in measurements}
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
    for r in rows:
        date = get(r, idx, "RECEIPT DATE")
        if not isinstance(date, dt.datetime) or date.year != 2026:
            continue
        status = str(get(r, idx, "STUTES") or "").strip().lower()
        if status == "cancel":
            report.count("Repairing: cancelled rows skipped")
            continue
        repairs.append({
            "meas_nos": parse_measurement_numbers(get(r, idx, "Measurement No")),
            "reported_on": date.date(),
            "reason": norm_name(get(r, idx, "Problem")) or "Repair",
            "charge": parse_money(get(r, idx, " INCL. VAT AMT")) or Decimal("0"),
            "raw_status": status,
            "collected": get(r, idx, "RECEIVED     DATE"),
        })
    report.count("Repairing: 2026 rows -> repair candidates", len(repairs))

    # Gift Orders is deliberately ignored: old coupons are not imported.
    return {
        "invoices": invoices,
        "measurements": measurements,
        "repairs": repairs,
        # Transient join key (never stored): measurement no -> receipt
        # numbers listing it. Per-order copies and repairs resolve through it.
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


def _canon_num(value: object) -> str:
    """Scale-insensitive numeric key for measurement signatures.

    NUMERIC(6, 2) storage normalizes scale (Decimal('32') comes back as
    Decimal('32.00')) and rounds past two decimals, so compare what Postgres
    keeps: quantized to 2dp (half away from zero, as NUMERIC does), then
    scale-free.
    """
    if value is None:
        return "NULL"
    try:
        d = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return str(value)
    d = d.normalize()
    if d == 0:
        return "0"
    return format(d, "f")


def measurement_signature(customer_id: str, measurement_date, values: dict) -> tuple:
    """Identity of a standalone measurement for re-run skipping.

    No stored number exists anymore, so a standalone row is "already present"
    when the same customer holds the same date + full value set.
    """
    return (
        customer_id,
        measurement_date.isoformat() if hasattr(measurement_date, "isoformat") else str(measurement_date),
        tuple(_canon_num(values.get(col)) if col not in MEASUREMENT_TEXT_COLS
              else str(values.get(col)) for col in MEASUREMENT_VALUE_COLS),
    )


def load_db_state(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT invoice_number FROM invoices")
        invoice_numbers = {row[0] for row in cur.fetchall()}
        cur.execute("SELECT name, mobile_no, id FROM customers")
        customer_rows = [(str(n), str(m), str(i)) for n, m, i in cur.fetchall()]
        cur.execute("SELECT order_id, reported_on, reason FROM order_repairs")
        repairs = {(str(a), b, c) for a, b, c in cur.fetchall()}
        cur.execute("SELECT name, id FROM branch WHERE is_active ORDER BY receives_orders DESC, id")
        branches = list(cur.fetchall())
        cur.execute("SELECT name, id FROM order_stages")
        stages = {str(name): str(id_) for name, id_ in cur.fetchall()}
        cur.execute(
            """
            SELECT customer_id, measurement_date,
                front_height, back_height, chest, waist, hip, shoulder,
                sleeve_length, neck_size, open_hand, chest_up, cuff_width,
                cuff_size, neck_width, armhole, fo_width, fo, full_body,
                sleeve_half, bottom, bottom_fold, open_fold,
                front_pocket_length,
                front_pocket_length_by_width,
                mobile_pocket_length_by_width,
                side_pocket_length_by_width
            FROM measurements
            """
        )
        measurement_sigs = set()
        for row in cur.fetchall():
            cid, mdate = str(row[0]), row[1]
            vals = dict(zip(MEASUREMENT_VALUE_COLS, row[2:]))
            measurement_sigs.add(measurement_signature(cid, mdate, vals))
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
        "branches": branches,
        "stages": stages,
        "measurement_sigs": measurement_sigs,
        "orders_by_invoice": orders_by_invoice,
    }


def choose_branch(conn, branch_arg: str | None, state: dict) -> tuple[str | None, str | None]:
    """Return (branch_id, created_name). branch_id is None when a new branch
    must be created."""
    if branch_arg:
        for name, id_ in state["branches"]:
            if name == branch_arg and id_:
                return id_, None
    elif state["branches"]:
        return state["branches"][0][1], None
    return None, branch_arg or DEFAULT_BRANCH


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
    """Whether a sheet row contributes anything to a per-order copy."""
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


def perform_insert(conn, workbook: dict, branch_id: str, report: Report,
                   material_name: str = DEFAULT_MATERIAL) -> None:
    state = load_db_state(conn)
    with conn.cursor() as cur:
        # ---- materials ------------------------------------------------------
        # Sheet material names are ignored: every order points at one
        # placeholder row, created here when missing (materials.name is
        # not unique, so match with LIMIT 1 rather than ON CONFLICT).
        cur.execute("SELECT id FROM materials WHERE name = %s LIMIT 1",
                    (material_name,))
        row = cur.fetchone()
        if row is None:
            cur.execute(
                "INSERT INTO materials (name, unit) VALUES (%s, 'meters') "
                "RETURNING id",
                (material_name,),
            )
            placeholder_material_id = str(cur.fetchone()[0])
            report.count(f"materials created: {material_name}")
        else:
            placeholder_material_id = str(row[0])
            report.count(f"materials reused: {material_name}")

        # ---- customers (canonical (name, phone), never merged) --------------
        # First-seen display spelling wins per canonical key. One phone with
        # several names and one name with several phones always stay separate
        # customers (see the workbook verification in read_workbook).
        # Referenced measurement rows get their own customer row too:
        # per-order copies below are owned by the measurement's customer
        # (measurement wins, always), so that customer must exist.
        display: dict[tuple[str, str], tuple[str, str]] = {}
        for inv in workbook["invoices"]:
            key = canon_key(inv["name"], inv["phone"])
            if key and key not in display:
                display[key] = (inv["name"], inv["phone"])
        for m in workbook["measurements"]:
            if m["key"] and m["key"] not in display:
                display[m["key"]] = (m["name"], m["phone"])
        db_customers: dict[tuple[str, str], str] = {}
        for name, mobile, id_ in state["customer_rows"]:
            key = canon_key(name, mobile)
            if key is None:
                continue
            if key not in db_customers:
                db_customers[key] = id_
            else:
                report.count("customers already merged in DB (same canonical key)")
        new_customers = {k: v for k, v in display.items() if k not in db_customers}
        for name, phone in new_customers.values():
            cur.execute(
                "INSERT INTO customers (name, mobile_no) VALUES (%s, %s) "
                "ON CONFLICT (name, mobile_no) DO UPDATE SET mobile_no = EXCLUDED.mobile_no",
                (name, phone),
            )
        report.count("customers created", len(new_customers))
        cur.execute("SELECT name, mobile_no, id FROM customers")
        customer_ids: dict[tuple[str, str], str] = {}
        for n, m, id_ in cur.fetchall():
            key = canon_key(str(n), str(m))
            if key and key not in customer_ids:
                customer_ids[key] = str(id_)

        # ---- measurements ---------------------------------------------------
        # Measurement No is a transient join key only: this map feeds the
        # per-order copies in the invoice loop below; nothing is stored.
        source_by_no = {m["measurement_no"]: m for m in workbook["measurements"]}

        # Standalone history: sheet rows no 2026 receipt references, imported
        # once each under their own sheet customer.
        # Referenced rows enter only via per-order copies owned by the
        # measurement's customer, falling back to the invoice's customer
        # only when the sheet row has no identifiable customer.
        standalone_to_add = []
        standalone_keys: dict[int, tuple] = {}
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
            standalone_keys[id(m)] = akey
            sig = measurement_signature(
                customer_ids[akey], m["measurement_date"], m["values"]
            )
            if sig in state["measurement_sigs"]:
                report.count("measurements already present (skipped)")
                continue
            standalone_to_add.append(m)
        cur.executemany(
            f"INSERT INTO measurements {MEASUREMENT_COLUMNS} "
            f"VALUES {MEASUREMENT_PLACEHOLDERS}",
            [measurement_params(customer_ids[standalone_keys[id(m)]], m)
             for m in standalone_to_add],
        )
        for m in standalone_to_add:
            state["measurement_sigs"].add(
                measurement_signature(
                    customer_ids[standalone_keys[id(m)]],
                    m["measurement_date"], m["values"]
                )
            )
        report.count("measurements standalone created", len(standalone_to_add))

        # ---- invoices + orders ----------------------------------------------
        stage_ids = state["stages"]
        made_stages = {("Cutting", "cutting_by"), ("Sewing", "tailor_by"),
                       ("Finishing", "finishing_by")}

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
            inv_key = canon_key(inv["name"], inv["phone"])
            if inv_key is None or inv_key not in customer_ids:
                report.anomaly("invoices skipped (no identifiable customer)",
                               inv["invoice_number"])
                continue
            total = inv["final"]
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
                    discount, discount_unit, customer_id, gift_card_redeemed
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'amount', %s, 0)
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
            # One snapshot per listed number, always owned by the measurement
            # row's customer. On a phone conflict between the receipt and
            # the sheet row, the measurement phone is therefore the one kept.
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
                src_key = src["key"]
                if src_key is not None and src_key in customer_ids:
                    owner_key = src_key
                    report.count("orders owned by measurement customer")
                else:
                    report.anomaly(
                        "orders kept receipt owner (measurement owner unknown)",
                        no)
                cur.execute(
                    f"INSERT INTO measurements {MEASUREMENT_COLUMNS} "
                    f"VALUES {MEASUREMENT_PLACEHOLDERS} RETURNING id",
                    measurement_params(customer_ids[owner_key], src),
                )
                copies.append((cur.fetchone()[0], src))
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
                        measurement_id, material_id, material_amount, invoice_id, price,
                        thobe_type, f_pocket, collar, sleeve, patti, emd, more_details,
                        status, collected_at, production_branch_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
                    RETURNING id
                    """,
                    (
                        measurement_id,
                        material_id,
                        Decimal("0"),
                        invoice_id,
                        prices[k],
                        design.get("thobe_type"),
                        design.get("f_pocket"),
                        design.get("collar"),
                        design.get("sleeve"),
                        design.get("patti"),
                        inv["emd"],
                        design.get("more_details"),
                        "collected" if inv["status"] == "done" else "pending",
                        collected_at,
                    ),
                )
                order_id = cur.fetchone()[0]
                order_by_invoice[inv["invoice_number"]].append(str(order_id))
                report.count("orders created")

                # Staff assignment on the cutting/sewing/finishing stages.
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

        # Advance the identity sequence so the app's next invoice can't collide.
        cur.execute(
            "SELECT setval(pg_get_serial_sequence('invoices', 'invoice_number'),"
            " (SELECT MAX(invoice_number) FROM invoices))"
        )

        # ---- repairs --------------------------------------------------------
        # Measurement No stays a transient key: number -> receipt(s) listing
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
                        help="branch name for all invoices (created if missing)")
    parser.add_argument("--material", default=DEFAULT_MATERIAL,
                        help="placeholder material every order points at "
                             "(created if missing; sheet names are ignored)")
    parser.add_argument("--dry-run", action="store_true",
                        help="read the workbook only; write nothing")
    args = parser.parse_args()

    report = Report()
    workbook = read_workbook(Path(args.workbook), report)
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
        branch_id, created_name = choose_branch(conn, args.branch, load_db_state(conn))
        if branch_id is None:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO branch (name, receives_orders, holds_stock, is_active) "
                    "VALUES (%s, TRUE, TRUE, TRUE) RETURNING id",
                    (created_name,),
                )
                branch_id = cur.fetchone()[0]
            report.count(f"branch created: {created_name}")
        perform_insert(conn, workbook, branch_id, report,
                       material_name=args.material)
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
