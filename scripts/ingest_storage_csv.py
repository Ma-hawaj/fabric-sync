#!/usr/bin/env python3
"""Ingest the cloth storage count (``Storage(cloth ).csv``) into fabric-sync.

Reads the storage spreadsheet — one row per fabric colour (``c. no.``) with
its length in meters (``MATERS``) and code — and loads it into the Postgres
schema defined by ``backend/migrations/20260712000000_create_tables.sql``:

  Storage(cloth ).csv  -> materials + material_stock

Mapping decisions worth knowing:

 * One material per sheet row (each ``c. no.`` colour is its own row):
   ``materials.name`` is ``"<Name> <c. no.>"`` (``Zabrjad 1``) and ``sku``
   is ``"<code>-<c. no.>"`` (``GS160-1``). A row without a colour keeps the
   bare Name and code (``BLACK INDONAISA`` / ``BLACK - IND``); a row
   without a code falls back to the name for the sku (``STC 541F-1``); a
   non-numeric colour the code already ends with is not appended twice
   (``SEMI BLACK`` + ``BLACK`` stays ``SEMI BLACK`` — numeric coincidences
   such as code ``801`` + colour ``1`` always append, giving ``801-1``).
 * ``materials.family`` is the whitespace-collapsed Name (``Zabrjad``), so
   the inventory table can cluster a fabric's colours behind one filter.
   ``unit`` is ``'meters'``. ``Yard`` is ignored (25 yards = 22.86 meters
   is already baked into the ``MATERS`` figure) and so are the two
   ``Stock`` piece-count columns — piece counts have no schema home; meters
   are what ``material_stock`` tracks.
 * No branch is named in the sheet. All stock lands on one branch:
   ``--branch`` if given (created when missing), else the first active
   ``holds_stock`` branch, else a created 'Main Branch' — the same rule as
   ``scripts/ingest_xlsm.py``.
 * Re-runs add again: ``materials`` has no UNIQUE key, so an existing
   (name, sku) row is reused but its stock grows a second time (its family
   is backfilled when still NULL). Use ``--mode set`` to overwrite the
   branch quantity instead, or ingest once into a fresh database. The whole
   write happens in one transaction and rolls back on error.

Depends on ``python3 -m pip install psycopg2-binary`` (stdlib only beyond
that).

Run from the repository root, with DATABASE_URL exported (or --database-url):
  export DATABASE_URL=postgres://postgres:postgres@localhost:5432/fabric_sync
  python3 scripts/ingest_storage_csv.py --dry-run   # sheet only, no DB writes
  python3 scripts/ingest_storage_csv.py
  python3 scripts/ingest_storage_csv.py --branch "Central Workshop"
  python3 scripts/ingest_storage_csv.py --mode set  # re-run overwrites stock
"""

from __future__ import annotations

import argparse
import collections
import os
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parents[1]
STORAGE_CSV = ROOT / "Storage(cloth ).csv"
DEFAULT_BRANCH = "Main Branch"


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


def collapse(value: object) -> str | None:
    """Whitespace-collapsed string, or None when blank."""
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value).strip())
    return s or None


def parse_meters(value: object) -> Decimal | None:
    if value is None:
        return None
    s = str(value).strip().replace(",", "")
    if not s:
        return None
    try:
        return Decimal(s).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return None


def read_storage_rows(path: Path, report: Report) -> list[dict]:
    """Read the sheet into per-row dicts: name, code (None when blank), meters.

    The file is decoded as UTF-8 with a cp1256 fallback — the sheet carries
    non-UTF-8 bytes (e.g. 0x85 in the ``STC Maroon`` colour cell). The first
    two rows are the title (``Materails ... Stock ... Date``) and the column
    header (``Name, c. no., Yard, MATERS, code``); everything after is data
    followed by zero-filled padding rows, which are skipped like any other
    row without a name.
    """
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        text = path.read_text(encoding="cp1256")
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 3:
        report.count("storage: no data rows")
        return []
    rows = []
    for lineno, line in enumerate(lines[2:], start=3):
        cells = [c.strip() for c in line.split(",")]
        while len(cells) < 5:
            cells.append("")
        name = collapse(cells[0])
        colour = collapse(cells[1])
        meters = parse_meters(cells[3])
        code = collapse(cells[4])
        if name is None:
            report.count("storage: padding/blank rows skipped")
            continue
        if meters is None or meters <= 0:
            report.anomaly("storage: row without meters skipped",
                           f"line {lineno} ({name}/{colour})")
            continue
        rows.append({"name": name, "colour": colour, "meters": meters,
                     "code": code, "lineno": lineno})
    report.count("storage: data rows", len(rows))
    return rows


def material_name(name: str, colour: str | None) -> str:
    """Display name: the colour rides with the name (``Zabrjad 1``)."""
    return f"{name} {colour}" if colour else name


def material_sku(name: str, code: str | None, colour: str | None) -> str | None:
    """SKU: the colour rides with the code (``GS160-1``).

    No colour keeps the bare code; no code falls back to the name. A
    non-numeric colour the code already ends with is not appended twice
    (``SEMI BLACK``), nor is a colour the code already carries as a
    dash-suffix (``766 - 2``); numeric colours otherwise always append, since
    a code merely ending in the same digit (``801`` + ``1``) is coincidence,
    not identity.
    """
    if not colour:
        return code
    base = code if code else name
    if code:
        if not colour.isdigit() and code.casefold().endswith(colour.casefold()):
            return code
        if re.search(r"-\s*" + re.escape(colour) + r"$", code):
            return code
    return f"{base}-{colour}"


def group_materials(rows: list[dict]) -> dict[tuple[str, str | None], dict]:
    """Key sheet rows by (name, sku), carrying the family and meters.

    The sheet holds one row per colour, so this is normally 1:1 — the
    summing stays as a guard for a duplicated (Name, c. no.) pair.
    """
    groups: dict[tuple[str, str | None], dict] = {}
    for row in rows:
        name = material_name(row["name"], row["colour"])
        sku = material_sku(row["name"], row["code"], row["colour"])
        key = (name, sku)
        group = groups.get(key)
        if group is None:
            group = {"name": name, "sku": sku, "family": row["name"],
                     "meters": Decimal("0.00"), "rows": 0}
            groups[key] = group
        group["meters"] += row["meters"]
        group["rows"] += 1
    return groups


def load_branches(conn) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT name, id FROM branch "
            "WHERE is_active AND holds_stock ORDER BY id"
        )
        branches = list(cur.fetchall())
        if not branches:
            cur.execute("SELECT name, id FROM branch WHERE is_active ORDER BY id")
            branches = list(cur.fetchall())
    return branches


def choose_branch(conn, branch_arg: str | None,
                  report: Report) -> tuple[object, str]:
    """Return (branch_id, label). Creates the branch when missing."""
    branches = load_branches(conn)
    if branch_arg:
        for name, id_ in branches:
            if name == branch_arg:
                return id_, name
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO branch (name, receives_orders, holds_stock, is_active) "
                "VALUES (%s, TRUE, TRUE, TRUE) RETURNING id",
                (branch_arg,),
            )
            report.count(f"branch created: {branch_arg}")
            return cur.fetchone()[0], branch_arg
    if branches:
        return branches[0][1], branches[0][0]
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO branch (name, receives_orders, holds_stock, is_active) "
            "VALUES (%s, TRUE, TRUE, TRUE) RETURNING id",
            (DEFAULT_BRANCH,),
        )
        report.count(f"branch created: {DEFAULT_BRANCH}")
        return cur.fetchone()[0], DEFAULT_BRANCH


def perform_insert(conn, groups: dict, branch_id: object, branch_label: str,
                   report: Report, mode: str) -> None:
    with conn.cursor() as cur:
        for (name, sku), group in sorted(groups.items(),
                                         key=lambda kv: (kv[0][0], kv[0][1] or "")):
            # materials.name is not unique, so match with LIMIT 1 rather
            # than ON CONFLICT (same precedent as ingest_xlsm.py).
            cur.execute(
                "SELECT id, family FROM materials WHERE name = %s "
                "AND sku IS NOT DISTINCT FROM %s LIMIT 1",
                (name, sku),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "INSERT INTO materials (name, sku, unit, family) "
                    "VALUES (%s, %s, 'meters', %s) RETURNING id",
                    (name, sku, group["family"]),
                )
                material_id = cur.fetchone()[0]
                report.count("materials created")
            else:
                material_id, family = row
                if family is None:
                    cur.execute(
                        "UPDATE materials SET family = %s WHERE id = %s",
                        (group["family"], material_id),
                    )
                    report.count("materials backfilled with family")
                report.count("materials reused")
            if mode == "set":
                cur.execute(
                    "INSERT INTO material_stock (material_id, branch_id, quantity) "
                    "VALUES (%s, %s, %s) "
                    "ON CONFLICT (material_id, branch_id) "
                    "DO UPDATE SET quantity = EXCLUDED.quantity",
                    (material_id, branch_id, group["meters"]),
                )
            else:
                cur.execute(
                    "INSERT INTO material_stock (material_id, branch_id, quantity) "
                    "VALUES (%s, %s, %s) "
                    "ON CONFLICT (material_id, branch_id) "
                    "DO UPDATE SET quantity = material_stock.quantity "
                    " + EXCLUDED.quantity",
                    (material_id, branch_id, group["meters"]),
                )
            report.count("material_stock rows upserted")
    report.count(f"meters into {branch_label}",
                 sum(g["meters"] for g in groups.values()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=str(STORAGE_CSV),
                        help="path to the storage sheet (default: repo root)")
    parser.add_argument("--database-url", default=None,
                        help="defaults to $DATABASE_URL")
    parser.add_argument("--branch", default=None,
                        help="branch name for all stock (created if missing; "
                             "default: first active stock-holding branch)")
    parser.add_argument("--mode", choices=("add", "set"), default="add",
                        help="'add' sums onto existing branch stock "
                             "(default); 'set' overwrites it, so re-runs "
                             "converge instead of double-counting")
    parser.add_argument("--dry-run", action="store_true",
                        help="read the sheet only; write nothing")
    args = parser.parse_args()

    report = Report()
    rows = read_storage_rows(Path(args.csv), report)
    groups = group_materials(rows)
    report.count("storage: materials (name, sku)", len(groups))
    report.count("storage: families", len({g["family"] for g in groups.values()}))
    print(report.summary("sheet"))
    print(f"Materials: {len(groups)} from {len(rows)} colour rows; "
          f"total {sum(g['meters'] for g in groups.values()):.2f} meters.")
    for (name, sku), group in sorted(groups.items(),
                                     key=lambda kv: (kv[1]["family"], kv[0][0])):
        sku_label = sku if sku is not None else "(no sku)"
        print(f"  {group['meters']:9.2f} m  {name}  [{sku_label}]")
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
        branch_id, branch_label = choose_branch(conn, args.branch, report)
        print(f"Stock branch: {branch_label} (mode={args.mode})")
        perform_insert(conn, groups, branch_id, branch_label, report, args.mode)
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
