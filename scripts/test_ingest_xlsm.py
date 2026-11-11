"""Workbook-reading regressions; run with unittest discover -s scripts."""

import datetime as dt
import os
import tempfile
import unittest
import uuid
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import openpyxl
import psycopg2
from psycopg2 import sql

from customer_identity import CustomerIdentity

import ingest_storage_csv as storage
from ingest_locations import select_branch
from ingest_xlsm import (
    Report, apply_customer_identity, canon_key, choose_branch, customer_display,
    invoice_customer_key, legacy_customer_numbers, measurement_customer_key,
    measurement_signature, measurement_values_signature, MEASUREMENT_MATCH_COLS,
    consolidate_existing_measurements, parse_measurement, perform_insert, read_workbook,
    report_measurement_consolidation,
)


class InvoiceInsertTests(unittest.TestCase):
    def test_default_import_inserts_null_material_without_inventory_queries(self):
        """Default import inserts null material without inventory queries."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read()
        identities = {canon_key(row["name"], row["phone"])
                      for row in workbook["invoices"] + workbook["measurements"]}
        rows = [(name, phone, f"customer-{index}")
                for index, (name, phone) in enumerate(sorted(identities - {None}))]
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = ("inserted-id",)
        cur.fetchall.return_value = rows
        state = {"customer_rows": rows, "measurement_sigs": set(), "stages": {},
                 "orders_by_invoice": {}, "invoice_numbers": set(), "repairs": set()}
        with patch("ingest_xlsm.load_db_state", return_value=state), \
                patch("ingest_xlsm.require_branch", return_value=("branch-id", "Branch")), \
                patch("ingest_xlsm.select_branch", return_value=("production-id", "Workshop")):
            perform_insert(conn, workbook, "branch-id", report)
        orders = [call for call in cur.execute.call_args_list if "INSERT INTO orders" in call.args[0]]
        self.assertTrue(orders)
        for call in orders:
            query, params = call.args
            self.assertIsNone(params[1])
            self.assertEqual(params[5], "unknown")
            self.assertEqual(params[-1], "production-id")
            self.assertEqual(query.count("%s"), len(params))
        self.assertFalse(any("FROM materials" in call.args[0] or "INTO materials" in call.args[0]
                             for call in cur.execute.call_args_list))

    def test_invalid_placeholder_quantity_is_rejected_before_database_access(self):
        for value in ("0", "-1", "NaN", "Infinity", "0.001", "100000000"):
            with self.subTest(value=value):
                conn = MagicMock()
                with self.assertRaises(ValueError):
                    perform_insert(conn, {}, "branch-id", Report(),
                                   material_amount=Decimal(value))
                conn.cursor.assert_not_called()

    def test_import_saves_ten_percent_vat_without_changing_charged_total(self):
        """Import saves ten percent vat without changing charged total."""
        for gross, net, vat in [
            ("28.00", "25.45", "2.55"),
            ("11.00", "10.00", "1.00"),
            ("0.06", "0.05", "0.01"),
            ("0.00", "0.00", "0.00"),
        ]:
            with self.subTest(gross=gross):
                conn = MagicMock()
                cur = conn.cursor.return_value.__enter__.return_value
                cur.fetchone.side_effect = [
                    ("branch-id", "Import branch", True, True),
                    ("production-id", "Workshop"),
                    ("material-id",), ("invoice-id",),
                ]
                cur.fetchall.return_value = [("Customer", "+97333333333", "customer-id")]
                workbook = {
                    "measurements": [], "repairs": [], "meas_to_invoices": {},
                    "invoices": [{
                        "invoice_number": 13481, "name": "Customer",
                        "phone": "+97333333333", "final": Decimal(gross),
                        "discount": Decimal("2.00"), "delivery": None,
                        "invoice_date": dt.date(2026, 1, 8),
                        "advance": Decimal("0"), "status": "pending", "meas_nos": [],
                    }],
                }
                state = {
                    "customer_rows": [("Customer", "+97333333333", "customer-id")],
                    "measurement_sigs": set(), "stages": {},
                    "orders_by_invoice": {}, "invoice_numbers": set(), "repairs": set(),
                }
                with patch("ingest_xlsm.load_db_state", return_value=state):
                    perform_insert(conn, workbook, "branch-id", Report(), material_name="General")
                insert = next(call for call in cur.execute.call_args_list
                              if "INSERT INTO invoices" in call.args[0])
                sql, params = insert.args
                columns = sql.split("(", 1)[1].split(")", 1)[0]
                # These required tax columns have no database defaults.
                for column in ("vat_rate", "taxable_amount", "vat_amount"):
                    self.assertIn(column, columns)
                self.assertEqual(sql.count("%s"), len(params))
                self.assertEqual(params[2], Decimal(gross))
                self.assertEqual(params[6], Decimal("2.00"))
                self.assertEqual(params[-3:],
                                 (Decimal("0.10"), Decimal(net), Decimal(vat)))
                self.assertEqual(sum(params[-2:]), params[2])


class ParseMeasurementTests(unittest.TestCase):
    def test_symbols_attached_spaced_and_standalone(self):
        for symbol, fraction in [
            ("½", "0.5"), ("¼", "0.25"), ("¾", "0.75"),
            ("⅛", "0.125"), ("⅜", "0.375"), ("⅝", "0.625"), ("⅞", "0.875"),
        ]:
            for text, whole in [(symbol, 0), (f"55{symbol}", 55),
                                (f"55  {symbol}", 55), (f"55\u00a0{symbol}", 55)]:
                with self.subTest(text=text):
                    self.assertEqual(parse_measurement(text),
                                     (Decimal(whole) + Decimal(fraction), True))

    def test_slash_fractions(self):
        for text, expected in [("55 1/2", "55.5"), ("17 3/4", "17.75"),
                               ("⅛", "0.125"), ("1/8", "0.125"),
                               ("17 3 / 8", "17.375"), ("17 5⁄8", "17.625")]:
            with self.subTest(text=text):
                self.assertEqual(parse_measurement(text), (Decimal(expected), True))

    def test_existing_workbook_notation(self):
        for text, expected in [("15 ½ .1", "15.5"), ("1 ¼.1", "1.25"),
                               ("24. ½", "24.5"), ("18,5", "18.5"),
                               ("7. 75", "7.75"), ("24. ⅜", "24.375"),
                               ("17⅝.1", "17.625"), (32, "32"),
                               (17.125, "17.125"), (Decimal("17.875"), "17.875")]:
            with self.subTest(text=text):
                self.assertEqual(parse_measurement(text), (Decimal(expected), True))

    def test_blank_invalid_and_ambiguous_values(self):
        for text in [None, "", "   "]:
            self.assertEqual(parse_measurement(text), (None, True))
        for text in ["CANCEL", "SHIRT", "17-18", "17 ½ ¾", "1/0", "3/2",
                     "1/3", "55 1/2 extra", float("nan"), float("inf"),
                     Decimal("NaN"), True]:
            with self.subTest(text=text):
                self.assertEqual(parse_measurement(text), (None, False))

    def test_rerun_signatures_preserve_eighths_and_ignore_scale(self):
        date = dt.date(2026, 5, 1)
        def signature(value):
            return measurement_signature("customer", date, {"chest": value})
        self.assertEqual(signature(Decimal("42.125")), signature(Decimal("42.1250")))
        self.assertEqual(signature(42), signature(Decimal("42.000")))
        self.assertNotEqual(signature(Decimal("42.125")), signature(Decimal("42.13")))


class MeasurementConsolidationTests(unittest.TestCase):
    def test_changed_or_removed_records_are_rejected_before_references_are_rewritten(self):
        """Changed or removed records are rejected before references are rewritten."""
        date = dt.date(2026, 5, 1)
        baseline = [42 if col == "chest" else None for col in MEASUREMENT_MATCH_COLS]
        changed = [43 if col == "chest" else None for col in MEASUREMENT_MATCH_COLS]
        for rows in [[("keeper", "c", date, *baseline)],
                     [("duplicate", "c", date, *changed), ("keeper", "c", date, *baseline)]]:
            with self.subTest(rows=rows):
                state = {"measurement_ids": {measurement_values_signature("c", {"chest": 42}): "keeper"},
                         "measurement_duplicates": [("duplicate", "keeper")]}
                with patch("ingest_xlsm.execute_values", return_value=rows) as execute:
                    with self.assertRaisesRegex(ValueError, "Measurements changed"):
                        consolidate_existing_measurements(MagicMock(), state, Report())
                execute.assert_called_once()

    def test_values_match_at_database_precision_with_customer_scope(self):
        key = measurement_values_signature
        self.assertEqual(key("c", {"chest": 42}), key("c", {"chest": Decimal("42.000")}))
        self.assertEqual(key("c", {"chest": Decimal("42.1254")}), key("c", {"chest": Decimal("42.125")}))
        self.assertNotEqual(key("father", {"chest": 42}), key("son", {"chest": 42}))
        self.assertNotEqual(key("c", {"chest": Decimal("42.125")}), key("c", {"chest": Decimal("42.13")}))

    def test_type_fit_and_unmapped_body_fields_are_part_of_an_exact_match(self):
        """Type fit and unmapped body fields are part of an exact match."""
        key = measurement_values_signature
        baseline = {"chest": 42}
        for field, value in [("type", "body"), ("fit", "medium"), ("shoulder_down", 1),
                             ("side_pocket", 1), ("front_pocket_length_by_width", "7 * 7")]:
            with self.subTest(field=field):
                self.assertNotEqual(key("c", baseline), key("c", {**baseline, field: value}))

    def test_null_text_is_distinct_from_a_literal_none_string(self):
        self.assertNotEqual(measurement_values_signature("c", {"front_pocket_length_by_width": None}),
                            measurement_values_signature("c", {"front_pocket_length_by_width": "None"}))

    def test_dry_run_counts_one_set_for_identical_order_measurements(self):
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read()
        apply_customer_identity(workbook, CustomerIdentity([], canon_key))
        report_measurement_consolidation(workbook, report)
        self.assertEqual(report.numeric["measurement sets after consolidation"], 1)
        self.assertEqual(report.numeric["duplicate measurement records consolidated"], 8)


class ReadWorkbookTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.date = dt.datetime(2026, 5, 1)
        self.invoices = [
            [no, self.date, "Receipt Customer", "33333333", "7 & 8 & 9", 30]
            for no in (101, "102", 103.0)
        ]
        self.measurements = [
            [no, self.date, "Sheet Customer", "34444444", 42, "29", "3"]
            for no in (7, "8", 9.0)
        ]

    def read(self, invoices=None, measurements=None):
        wb = openpyxl.Workbook()
        wb.active.title = "New"
        wb["New"].append([
            "Invoice", "Invoice Date", "Name", "Telephone", "Measurement No",
            "Final Amount",
        ])
        for row in self.invoices if invoices is None else invoices:
            wb["New"].append(row)
        ws = wb.create_sheet("Measurments")
        ws.append([
            "Measurement No", "Date", "Customer Name", "Customer Telephone",
            "Chest", "Button", "Button Fold",
        ])
        for row in self.measurements if measurements is None else measurements:
            ws.append(row)
        wb.create_sheet("Repairing").append(["RECEIPT DATE", "Measurement No"])
        path = Path(self.tempdir.name) / "orders.xlsm"
        wb.save(path)
        wb.close()
        report = Report()
        return read_workbook(path, report), report

    def test_invalid_invoice_numbers_are_reported_and_valid_rows_unchanged(self):
        expected, _ = self.read()
        rows = list(self.invoices)
        for index, value in enumerate((None, "", "   ", "not-a-number", self.date)):
            rows.insert(index * 2, [
                value, self.date, "Invalid Receipt", "35555555", "99", 10,
            ])
        actual, report = self.read(invoices=rows)
        self.assertEqual(actual, expected)
        self.assertEqual([inv["invoice_number"] for inv in actual["invoices"]],
                         [101, 102, 103])
        # Empty Excel strings load as None, retaining the existing anomaly.
        self.assertEqual(report.numeric["New: dated row without invoice number"], 2)
        self.assertEqual(report.numeric["New: invalid invoice number skipped"], 3)
        self.assertIn("not-a-number", report.summary("workbook"))

    def test_invalid_measurement_numbers_are_reported_and_valid_rows_unchanged(self):
        expected, _ = self.read()
        rows = list(self.measurements)
        for index, value in enumerate((None, "", "   ", "not-a-number", self.date)):
            rows.insert(index * 2, [
                value, self.date, "Invalid Measurement", "35555555", 40,
            ])
        actual, report = self.read(measurements=rows)
        self.assertEqual(actual, expected)
        self.assertEqual([m["measurement_no"] for m in actual["measurements"]],
                         [7, 8, 9])
        self.assertEqual(report.numeric[
            "Measurments: invalid measurement number skipped"
        ], 5)
        self.assertIn("not-a-number", report.summary("workbook"))

    def test_measurement_duplicate_selection_is_preserved(self):
        rows = [
            [7, dt.datetime(2026, 1, 1), "Customer", "33333333", 40],
            [7, self.date, "Customer", "33333333", 42],
            [7, dt.datetime(2026, 4, 1), "Customer", "33333333", 41],
            [7, dt.datetime(2026, 6, 1), "Customer", "33333333", 43],
        ]
        actual, report = self.read(invoices=[], measurements=rows)
        self.assertEqual(len(actual["measurements"]), 1)
        measurement = actual["measurements"][0]
        self.assertEqual(measurement["measurement_date"], dt.date(2026, 6, 1))
        self.assertEqual(measurement["values"]["chest"], Decimal("43"))
        self.assertEqual(report.numeric["Measurments: edit kept over placeholder"], 2)
        self.assertEqual(report.numeric["Measurments: duplicate number dropped"], 1)

    def test_customer_numbers_use_highest_number_and_keep_shared_phones_separate(self):
        workbook, report = self.read(invoices=[], measurements=[
            [9179, self.date, "Customer", "33333333", 42],
            [6216, self.date, "CUSTOMER", "33333333", 40],
            [8000, self.date, "Family Member", "33333333", 38],
            [9999, self.date, None, None, 40],
        ])
        numbers, reserved_max = legacy_customer_numbers(workbook, report)
        self.assertEqual(numbers, {
            canon_key("Customer", "33333333"): 9179,
            canon_key("Family Member", "33333333"): 8000,
        })
        self.assertEqual(reserved_max, 9999)
        self.assertEqual(report.numeric["customers: highest measurement number selected"], 1)

    def test_customer_number_belongs_to_measurement_owner(self):
        workbook, report = self.read()
        numbers, reserved_max = legacy_customer_numbers(workbook, report)
        self.assertEqual(numbers, {canon_key("Sheet Customer", "34444444"): 9})
        self.assertEqual(reserved_max, 9)
        self.assertNotIn(canon_key("Receipt Customer", "33333333"), numbers)

    def test_ownerless_measurement_only_maps_to_an_unambiguous_receipt_customer(self):
        workbook, report = self.read(
            invoices=[
                [101, self.date, "Customer", "33333333", "7 & 8 & 9000", 30],
                [102, self.date, "Other", "34444444", "8", 30],
            ],
            measurements=[
                [7, self.date, None, None, 42],
                [8, self.date, None, None, 40],
            ],
        )
        numbers, reserved_max = legacy_customer_numbers(workbook, report)
        self.assertEqual(numbers, {canon_key("Customer", "33333333"): 7})
        self.assertEqual(reserved_max, 9000)
        self.assertEqual(report.numeric[
            "customers: shared ownerless measurement (automatic IDs used)"
        ], 1)

    def test_linked_measurement_name_replaces_receipt_variants(self):
        """Linked measurement name replaces receipt variants."""
        workbook, _ = self.read(
            invoices=[[101, self.date, "Receipt variation", "33333333", "7", 30]],
            measurements=[[7, self.date, "Measurement name", "34444444", 42]],
        )
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        display, _ = customer_display(workbook, sources)
        expected = canon_key("Measurement name", "34444444")
        self.assertEqual(invoice_customer_key(workbook, workbook["invoices"][0], sources), expected)
        self.assertEqual(display, {expected: ("Measurement name", "+97334444444")})

    def test_shared_phone_with_multiple_measurement_customers_stays_separate(self):
        """Shared phone with multiple measurement customers stays separate."""
        workbook, _ = self.read(
            invoices=[[101, self.date, "Family buyer", "33333333", "7 & 8", 30]],
            measurements=[[7, self.date, "Father", "33333333", 42],
                          [8, self.date, "Son", "33333333", 30]],
        )
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        display, _ = customer_display(workbook, sources)
        self.assertEqual(len(display), 3)
        self.assertNotEqual(sources[7]["key"], sources[8]["key"])
        self.assertEqual(invoice_customer_key(workbook, workbook["invoices"][0], sources),
                         canon_key("Family buyer", "33333333"))

    def test_measurement_name_can_use_linked_receipt_phone(self):
        """Measurement name can use linked receipt phone."""
        workbook, report = self.read(
            invoices=[[101, self.date, "Receipt variation", "33333333", "7", 30]],
            measurements=[[7, self.date, "Measurement name", None, 42]],
        )
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        expected = canon_key("Measurement name", "33333333")
        self.assertEqual(invoice_customer_key(workbook, workbook["invoices"][0], sources), expected)
        self.assertEqual(measurement_customer_key(workbook, sources[7], workbook["invoices"][0]), expected)
        self.assertEqual(legacy_customer_numbers(workbook, report)[0], {expected: 7})
        self.assertEqual(list(customer_display(workbook, sources)[0].values()),
                         [("Measurement name", "+97333333333")])

    def test_receipt_name_is_fallback_when_measurement_has_no_name(self):
        """Receipt name is fallback when measurement has no name."""
        workbook, _ = self.read(
            invoices=[[101, self.date, "Receipt name", "33333333", "7", 30]],
            measurements=[[7, self.date, None, None, 42]],
        )
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        expected = canon_key("Receipt name", "33333333")
        self.assertEqual(invoice_customer_key(workbook, workbook["invoices"][0], sources), expected)
        self.assertEqual(list(customer_display(workbook, sources)[0].values()),
                         [("Receipt name", "+97333333333")])

    def test_measurement_spelling_wins_for_reviewed_aliases(self):
        """Measurement spelling wins for reviewed aliases."""
        workbook, _ = self.read(
            invoices=[[101, self.date, "Ali Ahmad", "33333333", "7", 30]],
            measurements=[[20, dt.datetime(2026, 6, 1), "Ali Ahmad", "33333333", 42],
                          [7, self.date, "Ali Ahmed", "33333333", 43]],
        )
        identity = CustomerIdentity([{"phone": "33333333", "names": ["Ali Ahmad", "Ali Ahmed"],
                                     "decision": "same"}], canon_key)
        apply_customer_identity(workbook, identity)
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        self.assertEqual(list(customer_display(workbook, sources)[0].values()),
                         [("Ali Ahmed", "+97333333333")])

    def test_last_measurement_name_uses_sheet_order_with_missing_phones(self):
        """Last measurement name uses sheet order with missing phones."""
        for phones in [("33333333", None), (None, "33333333"), (None, None)]:
            with self.subTest(phones=phones):
                workbook, _ = self.read(
                    invoices=[[101, self.date, "Receipt", "33333333", "20", 30],
                              [102, self.date, "Receipt", "33333333", "7", 30]],
                    measurements=[[7, self.date, "Ali Ahmad", phones[0], 42],
                                  [20, self.date, "Ali Ahmed", phones[1], 43]],
                )
                apply_customer_identity(workbook, CustomerIdentity([
                    {"phone": "33333333", "names": ["Ali Ahmad", "Ali Ahmed"], "decision": "same"}
                ], canon_key))
                sources = {m["measurement_no"]: m for m in workbook["measurements"]}
                self.assertEqual(list(customer_display(workbook, sources)[0].values()),
                                 [("Ali Ahmed", "+97333333333")])

    def test_last_name_uses_retained_duplicate_row_position_without_reordering_history(self):
        """Last name uses retained duplicate row position without reordering history."""
        workbook, _ = self.read(invoices=[], measurements=[
            [7, dt.datetime(2026, 1, 1), "Discarded spelling", "33333333", 40],
            [20, self.date, "Ali Ahmad", "33333333", 42],
            [7, dt.datetime(2026, 6, 1), "Ali Ahmed", "33333333", 43],
        ])
        apply_customer_identity(workbook, CustomerIdentity([
            {"phone": "33333333", "names": ["Ali Ahmad", "Ali Ahmed"], "decision": "same"}
        ], canon_key))
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        self.assertEqual(list(customer_display(workbook, sources)[0].values()),
                         [("Ali Ahmed", "+97333333333")])
        self.assertEqual([m["measurement_no"] for m in workbook["measurements"]], [7, 20])
        self.assertEqual(workbook["measurement_source_order"], [20, 7])

    def test_measurements_identify_receipt_with_missing_contact(self):
        """Measurements identify receipt with missing contact."""
        workbook, _ = self.read(
            invoices=[[101, self.date, None, None, "7", 30]],
            measurements=[[7, self.date, "Measurement name", "33333333", 42]],
        )
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        self.assertEqual(invoice_customer_key(workbook, workbook["invoices"][0], sources),
                         canon_key("Measurement name", "33333333"))

    def test_button_columns_are_imported_as_bottom(self):
        # The sheet misspells Bottom / Bottom Fold as Button / Button Fold;
        # the values are hem widths and land on the bottom columns.
        actual, _ = self.read()
        self.assertEqual(len(actual["measurements"]), 3)
        for measurement in actual["measurements"]:
            self.assertEqual(measurement["values"]["bottom"], Decimal("29"))
            self.assertEqual(
                measurement["values"]["bottom_fold"], Decimal("3"))
            self.assertNotIn("button", measurement["values"])
            self.assertNotIn("button_fold", measurement["values"])

    def test_fraction_cells_are_imported_without_losing_eighths(self):
        rows = [
            [7, self.date, "Customer", "33333333", "42 ½", "29¼", "3 ⅛"],
            [8, self.date, "Customer", "33333333", "42 3/8", "29¾", "3⅞"],
        ]
        actual, _ = self.read(measurements=rows)
        expected = [("42.5", "29.25", "3.125"), ("42.375", "29.75", "3.875")]
        for measurement, values in zip(actual["measurements"], expected, strict=True):
            for key, value in zip(["chest", "bottom", "bottom_fold"], values):
                self.assertEqual(measurement["values"][key], Decimal(value))


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"),
                     "set TEST_DATABASE_URL to a disposable PostgreSQL 18+ database")
class DatabaseIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.conn = psycopg2.connect(os.environ["TEST_DATABASE_URL"])
        self.addCleanup(self.conn.close)
        self.addCleanup(self.conn.rollback)
        self.root = Path(__file__).resolve().parents[1]
        # All DDL/data remains in this transaction and is rolled back on cleanup.
        schema = "ingest_test_" + uuid.uuid4().hex
        with self.conn.cursor() as cur:
            cur.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            cur.execute(sql.SQL("SET LOCAL search_path TO {}, public")
                        .format(sql.Identifier(schema)))
            for migration in sorted((self.root / "backend/migrations").glob("*.sql")):
                cur.execute(migration.read_text())
            cur.execute((self.root / "backend/seeds/reference_data.sql").read_text())

    def new_branch(self, name, receives=False, stock=False, produces=False, active=True):
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO branch(name,receives_orders,holds_stock,produces_orders,is_active) "
                "VALUES(%s,%s,%s,%s,%s) RETURNING id",
                (name, receives, stock, produces, active),
            )
            return cur.fetchone()[0]

    def sample_workbook(self):
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        return fixture.read()

    def test_import_defaults_to_first_active_production_branch_and_preserves_unknown_stock(self):
        self.new_branch("Inactive workshop", produces=True, active=False)
        warehouse = self.new_branch("Warehouse", stock=True)
        pickup = self.new_branch("Pickup", receives=True)
        first = self.new_branch("First workshop", produces=True)
        second = self.new_branch("Second workshop", produces=True)
        workbook, report = self.sample_workbook()
        self.assertEqual(choose_branch(self.conn, None, report), (pickup, "Pickup"))
        self.assertEqual(storage.choose_branch(self.conn, None, storage.Report()),
                         (warehouse, "Warehouse"))
        perform_insert(self.conn, workbook, pickup, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT DISTINCT branch_id,issuing_branch_id,issuing_branch_name,collection_method FROM invoices")
            self.assertEqual(cur.fetchall(), [(pickup, pickup, "Pickup", "pickup")])
            cur.execute("SELECT DISTINCT production_branch_id,material_stock_branch_id FROM orders")
            self.assertEqual(cur.fetchall(), [(first, None)])
            cur.execute("SELECT count(*) FROM material_stock")
            self.assertEqual(cur.fetchone()[0], 0)
            # A rerun must not replace historical assignments or the issued name.
            cur.execute("UPDATE branch SET is_active=FALSE WHERE id=%s", (first,))
            cur.execute("UPDATE branch SET name='Renamed pickup' WHERE id=%s", (pickup,))
        perform_insert(self.conn, workbook, pickup, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT DISTINCT production_branch_id,material_stock_branch_id FROM orders")
            self.assertEqual(cur.fetchall(), [(first, None)])
            cur.execute("SELECT DISTINCT issuing_branch_name FROM invoices")
            self.assertEqual(cur.fetchall(), [("Pickup",)])
        self.assertEqual(select_branch(self.conn, None, "produces_orders", None, report),
                         (second, "Second workshop"))

    def test_explicit_production_override_is_saved(self):
        pickup = self.new_branch("Pickup", receives=True)
        self.new_branch("First workshop", produces=True)
        override = self.new_branch("Override workshop", produces=True)
        workbook, report = self.sample_workbook()
        perform_insert(self.conn, workbook, pickup, report, production_branch_id=override)
        with self.conn.cursor() as cur:
            cur.execute("SELECT DISTINCT production_branch_id FROM orders")
            self.assertEqual(cur.fetchall(), [(override,)])

    def test_missing_production_configuration_fails_before_import_writes(self):
        pickup = self.new_branch("Pickup", receives=True)
        self.new_branch("Inactive workshop", produces=True, active=False)
        self.new_branch("Warehouse", stock=True)
        with self.assertRaisesRegex(ValueError, "no active production branch"):
            perform_insert(self.conn, {}, pickup, Report())
        with self.conn.cursor() as cur:
            for table in ("materials", "customers", "invoices", "orders"):
                cur.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table)))
                self.assertEqual(cur.fetchone()[0], 0, table)

    def test_named_import_branches_must_be_active_and_support_the_requested_role(self):
        workshop = self.new_branch("Workshop", produces=True)
        self.new_branch("Inactive", receives=True, stock=True, produces=True, active=False)
        pickup = self.new_branch("Pickup", receives=True)
        for name in ("Workshop", "Inactive"):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "receives_orders"):
                    choose_branch(self.conn, name, Report())
                with self.assertRaisesRegex(ValueError, "holds_stock"):
                    storage.choose_branch(self.conn, name, storage.Report())
        for branch in ("Pickup", "Inactive"):
            with self.assertRaisesRegex(ValueError, "produces_orders"):
                select_branch(self.conn, branch, "produces_orders", None, Report())
        with self.assertRaisesRegex(ValueError, "receives_orders"):
            perform_insert(self.conn, {}, workshop, Report())
        with self.assertRaisesRegex(ValueError, "produces_orders"):
            perform_insert(self.conn, {}, pickup, Report(), production_branch_id=pickup)
        with self.assertRaisesRegex(ValueError, "holds_stock"):
            storage.perform_insert(self.conn, {}, workshop, "Workshop", storage.Report(), "set")
        with self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM branch")
            self.assertEqual(cur.fetchone()[0], 3)

    def test_default_pickup_and_stock_branches_are_separate_from_production(self):
        workshop = self.new_branch("Workshop", produces=True)
        pickup, _ = choose_branch(self.conn, None, Report())
        warehouse, _ = storage.choose_branch(self.conn, None, storage.Report())
        self.assertNotEqual(pickup, workshop)
        self.assertNotEqual(warehouse, workshop)
        self.assertNotEqual(warehouse, pickup)
        with self.conn.cursor() as cur:
            cur.execute("SELECT receives_orders,holds_stock,produces_orders FROM branch WHERE id=%s", (pickup,))
            self.assertEqual(cur.fetchone(), (True, False, False))
            cur.execute("SELECT receives_orders,holds_stock,produces_orders FROM branch WHERE id=%s", (warehouse,))
            self.assertEqual(cur.fetchone(), (False, True, False))
        self.assertEqual(choose_branch(self.conn, None, Report())[0], pickup)
        self.assertEqual(storage.choose_branch(self.conn, None, storage.Report())[0], warehouse)

    def test_named_workshop_is_created_with_only_production_enabled(self):
        workshop, label = select_branch(self.conn, "New workshop", "produces_orders", None, Report())
        self.assertEqual(label, "New workshop")
        with self.conn.cursor() as cur:
            cur.execute("SELECT receives_orders,holds_stock,produces_orders,is_active FROM branch WHERE id=%s", (workshop,))
            self.assertEqual(cur.fetchone(), (False, False, True, True))
        self.assertEqual(select_branch(self.conn, "New workshop", "produces_orders", None, Report()),
                         (workshop, label))

    def test_stock_import_only_changes_stock_at_the_selected_warehouse(self):
        workshop = self.new_branch("Workshop", produces=True)
        warehouse = self.new_branch("Warehouse", stock=True)
        groups = {("Cotton white", "CT-1"): {"family": "Cotton", "meters": Decimal("12.50")}}
        for mode in ("set", "set", "add"):
            storage.perform_insert(self.conn, groups, warehouse, "Warehouse", storage.Report(), mode)
        with self.conn.cursor() as cur:
            cur.execute("SELECT branch_id,quantity FROM material_stock")
            self.assertEqual(cur.fetchall(), [(warehouse, Decimal("25.00"))])
            cur.execute("SELECT holds_stock,produces_orders FROM branch WHERE id=%s", (workshop,))
            self.assertEqual(cur.fetchone(), (False, True))

    def test_workbook_insert_payments_repairs_and_idempotent_rerun(self):
        """Workbook insert payments repairs and idempotent rerun."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read()
        workbook["measurements"][0]["design"]["collar"] = "Saudi"
        workbook["measurements"][1]["design"]["collar"] = "Emirati"
        invoice = workbook["invoices"][0]
        invoice.update(final=Decimal("28.00"), discount=Decimal("2.00"),
                       advance=Decimal("10.00"), status="done", pay1="cash")
        workbook["repairs"] = [{
            "meas_nos": [7], "reported_on": dt.date(2026, 6, 1),
            "reason": "Adjust sleeve", "charge": Decimal("1.00"),
            "raw_status": "done", "collected": dt.datetime(2026, 6, 2),
        }]
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch (name, produces_orders) VALUES ('Import test', TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report,
                       material_amount=Decimal("2.50"))
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, name, customer_number FROM customers ORDER BY id")
            original_customers = cur.fetchall()
            self.assertEqual({name: number for _, name, number in original_customers},
                             {"Sheet Customer": 9})
            cur.execute("SELECT DISTINCT c.customer_number FROM orders o "
                        "JOIN measurements m ON m.id = o.measurement_id "
                        "JOIN customers c ON c.id = m.customer_id")
            self.assertEqual(cur.fetchall(), [(9,)])
            cur.execute("SELECT m.id, readable_measurement_id(c.customer_number, m.measurement_number) "
                        "FROM measurements m JOIN customers c ON c.id=m.customer_id "
                        "ORDER BY m.measurement_number")
            original_measurements = cur.fetchall()
            self.assertEqual([code for _, code in original_measurements],
                             ["C-9-001"])
            cur.execute("SELECT COUNT(DISTINCT measurement_id) FROM orders")
            self.assertEqual(cur.fetchone()[0], 1)
            cur.execute("SELECT collar,COUNT(*) FROM orders GROUP BY collar")
            self.assertCountEqual(cur.fetchall(), [("Saudi", 3), ("Emirati", 3), (None, 3)])
            cur.execute("SELECT total_price, vat_rate, taxable_amount, vat_amount "
                        "FROM invoices WHERE invoice_number = 101")
            self.assertEqual(cur.fetchone(), tuple(map(Decimal,
                             ("28.00", "0.10", "25.45", "2.55"))))
            cur.execute("SELECT sum(amount) FROM invoice_payments")
            self.assertEqual(cur.fetchone()[0], Decimal("28.00"))
            cur.execute("SELECT count(*) FROM order_repairs")
            self.assertEqual(cur.fetchone()[0], 1)
            cur.execute("SELECT count(*), sum(price) FROM orders")
            self.assertEqual(cur.fetchone(), (9, Decimal("88.00")))
            cur.execute("SELECT DISTINCT material_id, material_source FROM orders")
            self.assertEqual(cur.fetchall(), [(None, "unknown")])
            cur.execute("SELECT count(*) FROM materials")
            self.assertEqual(cur.fetchone()[0], 0)
            cur.execute("SELECT min(material_amount), max(material_amount) FROM orders")
            self.assertEqual(cur.fetchone(), (Decimal("2.50"), Decimal("2.50")))
        perform_insert(self.conn, workbook, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, name, customer_number FROM customers ORDER BY id")
            self.assertEqual(cur.fetchall(), original_customers)
            cur.execute("SELECT m.id, readable_measurement_id(c.customer_number, m.measurement_number) "
                        "FROM measurements m JOIN customers c ON c.id=m.customer_id "
                        "ORDER BY m.measurement_number")
            self.assertEqual(cur.fetchall(), original_measurements)
            for table, count in (("invoices", 3), ("orders", 9),
                                 ("invoice_payments", 2), ("order_repairs", 1)):
                cur.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table)))
                self.assertEqual(cur.fetchone()[0], count, table)
            cur.execute("INSERT INTO customers(name, mobile_no) "
                        "VALUES('New app customer', '35555555') RETURNING customer_number")
            self.assertEqual(cur.fetchone()[0], 10)

    def test_identical_history_and_orders_share_one_set_with_its_latest_date(self):
        """Identical history and orders share one set with its latest date."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        june, july = dt.datetime(2026, 6, 1), dt.datetime(2026, 7, 1)
        workbook, report = fixture.read(
            invoices=[[101, july, "Customer", "33333333", "9", 30]],
            measurements=[[7, fixture.date, "Customer", "33333333", 42],
                          [8, june, "Customer", "33333333", "42.000"],
                          [9, july, "Customer", "33333333", 42],
                          [10, june, "Customer", "33333333", 43]])
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Shared snapshots',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,chest,measurement_date FROM measurements ORDER BY measurement_date DESC")
            rows = cur.fetchall()
            self.assertEqual([(chest, date) for _, chest, date in rows],
                             [(Decimal("42"), july.date()), (Decimal("43"), june.date())])
            cur.execute("SELECT DISTINCT measurement_id FROM orders")
            self.assertEqual(cur.fetchall(), [(rows[0][0],)])
        self.assertEqual(report.numeric["measurements standalone created"], 2)
        self.assertEqual(report.numeric["measurements identical reused"], 2)
        perform_insert(self.conn, workbook, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,chest,measurement_date FROM measurements ORDER BY measurement_date DESC")
            self.assertEqual(cur.fetchall(), rows)

    def test_existing_exact_duplicates_repoint_orders_and_repair_fixes_without_reusing_numbers(self):
        """Existing exact duplicates repoint orders and repair fixes without reusing numbers."""
        workbook, report = self.sample_workbook()
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Existing duplicates',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,customer_id,measurement_number FROM measurements")
            keeper, customer, number = cur.fetchone()
            self.assertEqual(number, 1)
            cur.execute("INSERT INTO measurements(customer_id,measurement_date,chest,bottom,bottom_fold) "
                        "VALUES(%s,'2026-06-01',42,29,3) RETURNING id,measurement_number", (customer,))
            duplicate, duplicate_number = cur.fetchone()
            cur.execute("SELECT id,invoice_id,price,status FROM orders ORDER BY id")
            orders = cur.fetchall()
            cur.execute("UPDATE orders SET measurement_id=%s WHERE id=%s", (duplicate, orders[0][0]))
            cur.execute("INSERT INTO order_repairs(order_id,reason,fixed_measurement_id) "
                        "VALUES(%s,'Existing fix',%s) RETURNING id", (orders[0][0], duplicate))
            repair = cur.fetchone()[0]
        rerun = Report()
        perform_insert(self.conn, workbook, branch, rerun)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,measurement_number,measurement_date FROM measurements")
            self.assertEqual(cur.fetchall(), [(keeper, number, dt.date(2026, 6, 1))])
            cur.execute("SELECT DISTINCT measurement_id FROM orders")
            self.assertEqual(cur.fetchall(), [(keeper,)])
            cur.execute("SELECT fixed_measurement_id FROM order_repairs WHERE id=%s", (repair,))
            self.assertEqual(cur.fetchone()[0], keeper)
            cur.execute("SELECT id,invoice_id,price,status FROM orders ORDER BY id")
            self.assertEqual(cur.fetchall(), orders)
            cur.execute("INSERT INTO measurements(customer_id,chest) VALUES(%s,43) RETURNING measurement_number", (customer,))
            self.assertEqual(cur.fetchone()[0], duplicate_number + 1)
        self.assertEqual(rerun.numeric["measurements existing duplicates consolidated"], 1)

    def test_exact_comparison_covers_every_stored_field_and_keeps_distinct_sets(self):
        """Exact comparison covers every stored field and keeps distinct sets."""
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO customers(name,mobile_no) VALUES('Stored fields','+97333333333') RETURNING id")
            customer = cur.fetchone()[0]
            entries = [
                (dt.date(2026, 5, 1), None, None, None, None, None),
                (dt.date(2026, 6, 1), None, None, None, None, None),
                (dt.date(2026, 5, 1), "body", "medium", None, None, None),
                (dt.date(2026, 5, 1), "thobe", "medium", None, None, None),
                (dt.date(2026, 5, 1), "body", "loose", None, None, None),
                (dt.date(2026, 5, 1), None, None, 1, None, None),
                (dt.date(2026, 5, 1), None, None, None, 1, None),
                (dt.date(2026, 5, 1), None, None, None, None, "None"),
            ]
            cur.executemany("INSERT INTO measurements(customer_id,chest,measurement_date,type,fit,"
                            "shoulder_down,side_pocket,front_pocket_length_by_width) "
                            "VALUES(%s,42,%s,%s,%s,%s,%s,%s)", [(customer, *entry) for entry in entries])
            cur.execute("SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema=current_schema() AND table_name='measurements'")
            actual = {row[0] for row in cur.fetchall()} - {"id", "customer_id", "measurement_date", "measurement_number"}
            self.assertEqual(actual, set(MEASUREMENT_MATCH_COLS))
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Full comparison',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        empty = {"measurements": [], "invoices": [], "repairs": [], "meas_to_invoices": {}}
        perform_insert(self.conn, empty, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM measurements WHERE customer_id=%s", (customer,))
            self.assertEqual(cur.fetchone()[0], 7)

    def test_measurement_spelling_updates_a_matched_customer_without_renumbering(self):
        """Measurement spelling updates a matched customer without renumbering."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Ali Ahmad", "33333333", "7", 30]],
            measurements=[[20, dt.datetime(2026, 6, 1), "ALI AHMAD", "33333333", 42],
                          [7, fixture.date, "Ali Ahmed", "33333333", 43]],
        )
        apply_customer_identity(workbook, CustomerIdentity([
            {"phone": "33333333", "names": ["Ali Ahmad", "Ali Ahmed"], "decision": "same"}
        ], canon_key))
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Priority test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
            cur.execute("INSERT INTO customers(name,mobile_no) VALUES('Ali Ahmad','+97333333333') RETURNING id,customer_number")
            customer_id, number = cur.fetchone()
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,name,customer_number FROM customers")
            self.assertEqual(cur.fetchall(), [(customer_id, "Ali Ahmed", number)])
            cur.execute("SELECT DISTINCT customer_id FROM invoices")
            self.assertEqual(cur.fetchall(), [(customer_id,)])
            cur.execute("SELECT DISTINCT customer_id FROM measurements")
            self.assertEqual(cur.fetchall(), [(customer_id,)])
        self.assertEqual(report.numeric["customer names updated from measurement sheet"], 1)
        rerun = Report()
        perform_insert(self.conn, workbook, branch, rerun)
        self.assertEqual(rerun.numeric["customer names updated from measurement sheet"], 0)

    def test_measurement_name_with_missing_phone_uses_receipt_phone(self):
        """Measurement name with missing phone uses receipt phone."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Receipt variation", "33333333", "7", 30]],
            measurements=[[7, fixture.date, "Measurement name", None, 42]],
        )
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Fallback test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT name,mobile_no,customer_number FROM customers")
            self.assertEqual(cur.fetchall(), [("Measurement name", "+97333333333", 7)])
            cur.execute("SELECT count(*) FROM orders")
            self.assertEqual(cur.fetchone()[0], 1)

    def test_database_only_unmeasured_customer_does_not_block_shared_phone_imports(self):
        """A database-only contact keeps their ID while workbook contacts use a measured owner."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Database contact scope',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
            cur.execute("INSERT INTO customers(name,mobile_no) VALUES('Father','+97333333333') RETURNING id")
            father = cur.fetchone()[0]
            cur.execute("INSERT INTO measurements(customer_id,measurement_date,chest) VALUES(%s,%s,42)",
                        (father, fixture.date.date()))
            cur.execute("INSERT INTO customers(name,mobile_no) VALUES('Mother','+97333333333') RETURNING id")
            mother = cur.fetchone()[0]
        for multiple in [False, True]:
            with self.subTest(multiple_measured_owners=multiple):
                workbook, report = fixture.read(
                    invoices=[[102 if multiple else 101, fixture.date, "Buyer", "33333333",
                               "7 & 8" if multiple else "7", 30]],
                    measurements=[[7, fixture.date, "Father", "33333333", 42]] +
                                 ([[8, fixture.date, "Son", "33333333", 30]] if multiple else []))
                if multiple:
                    apply_customer_identity(workbook, CustomerIdentity([
                        {"phone": "33333333", "names": ["Father", "Son"], "decision": "name", "name": "Father"}
                    ], canon_key))
                perform_insert(self.conn, workbook, branch, report)
                perform_insert(self.conn, workbook, branch, Report())
                with self.conn.cursor() as cur:
                    cur.execute("SELECT name,mobile_no FROM customers WHERE id=%s", (mother,))
                    self.assertEqual(cur.fetchone(), ("Mother", "+97333333333"))
                    cur.execute("SELECT COUNT(*) FROM measurements WHERE customer_id=%s", (mother,))
                    self.assertEqual(cur.fetchone()[0], 0)
                    cur.execute("SELECT customer_id FROM invoices WHERE invoice_number=%s", (102 if multiple else 101,))
                    self.assertEqual(cur.fetchone()[0], father)

    def test_father_and_son_on_one_receipt_keep_separate_customers(self):
        """Father and son on one receipt keep separate customers."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Family buyer", "33333333", "7 & 8", 30],
                      [102, fixture.date, "Receipt A", "33333333", None, 20],
                      [103, fixture.date, "Receipt B", "33333333", None, 20]],
            measurements=[[7, fixture.date, "Father", "33333333", 42],
                          [8, fixture.date, "Son", "33333333", 42]],
        )
        apply_customer_identity(workbook, CustomerIdentity([
            {"phone": "33333333", "names": ["Father", "Son"], "decision": "name", "name": "Father"}
        ], canon_key))
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Family test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT name,mobile_no FROM customers ORDER BY name")
            self.assertEqual(cur.fetchall(), [("Father", "+97333333333"), ("Son", "+97333333333")])
            cur.execute("SELECT DISTINCT c.name FROM orders o JOIN measurements m ON m.id=o.measurement_id "
                        "JOIN customers c ON c.id=m.customer_id ORDER BY c.name")
            self.assertEqual(cur.fetchall(), [("Father",), ("Son",)])
            cur.execute("SELECT DISTINCT c.name FROM invoices i JOIN customers c ON c.id=i.customer_id")
            self.assertEqual(cur.fetchall(), [("Father",)])
            cur.execute("SELECT id,name FROM customers ORDER BY name")
            original_customers = cur.fetchall()
        perform_insert(self.conn, workbook, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,name FROM customers ORDER BY name")
            self.assertEqual(cur.fetchall(), original_customers)

    def test_unmeasured_receipt_names_share_one_chosen_customer(self):
        """Unmeasured receipt names share one chosen customer."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Ali", "33333333", None, 30],
                      [102, fixture.date, "Aly", "33333333", None, 20]], measurements=[])
        apply_customer_identity(workbook, CustomerIdentity([
            {"phone": "33333333", "names": ["Ali", "Aly"], "decision": "name", "name": "Ali Ahmed"}
        ], canon_key))
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Phone test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,name,mobile_no FROM customers")
            rows = cur.fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][1:], ("Ali Ahmed", "+97333333333"))
            cur.execute("SELECT DISTINCT customer_id FROM invoices")
            self.assertEqual(cur.fetchall(), [(rows[0][0],)])
            cur.execute("SELECT count(*) FROM measurements")
            self.assertEqual(cur.fetchone()[0], 0)
        perform_insert(self.conn, workbook, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM customers")
            self.assertEqual(cur.fetchone()[0], 1)

    def test_measurement_references_assign_unreferenced_alias_receipts_to_the_right_family_member(self):
        """Measurement references assign unreferenced alias receipts to the right family member."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Alias A", "33333333", "7", 30],
                      [102, fixture.date, "Alias B", "33333333", "8", 20],
                      [103, fixture.date, "Alias A", "33333333", None, 30],
                      [104, fixture.date, "Alias B", "33333333", None, 20]],
            measurements=[[7, fixture.date, "Father", "33333333", 42],
                          [8, fixture.date, "Son", "33333333", 30]])
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Reference test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,name FROM customers ORDER BY name")
            customers = cur.fetchall()
            self.assertEqual([name for _, name in customers], ["Father", "Son"])
            cur.execute("SELECT i.invoice_number,c.name FROM invoices i JOIN customers c ON c.id=i.customer_id "
                        "ORDER BY i.invoice_number")
            self.assertEqual(cur.fetchall(), [(101, "Father"), (102, "Son"), (103, "Father"), (104, "Son")])
        perform_insert(self.conn, workbook, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,name FROM customers ORDER BY name")
            self.assertEqual(cur.fetchall(), customers)

    def test_one_measurement_identity_absorbs_unlinked_receipt_names(self):
        """One measurement identity absorbs unlinked receipt names."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Ali", "33333333", None, 30],
                      [102, fixture.date, "Aly", "33333333", None, 20]],
            measurements=[[7, fixture.date, "Measured name", "33333333", 42]])
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('One measured test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,name,customer_number FROM customers")
            rows = cur.fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][1:], ("Measured name", 7))
            cur.execute("SELECT DISTINCT customer_id FROM invoices")
            self.assertEqual(cur.fetchall(), [(rows[0][0],)])

    def test_verified_measured_variations_become_one_customer_with_all_history(self):
        """Verified measured variations become one customer with all history."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(invoices=[], measurements=[
            [7, fixture.date, "Ali", "33333333", 42],
            [8, fixture.date, "Aly", "33333333", 43]])
        apply_customer_identity(workbook, CustomerIdentity([
            {"phone": "33333333", "names": ["Ali", "Aly"], "decision": "same"}
        ], canon_key))
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Verified test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM customers")
            self.assertEqual(cur.fetchone()[0], 1)
            cur.execute("SELECT count(*) FROM measurements")
            self.assertEqual(cur.fetchone()[0], 2)

    def test_existing_measured_father_is_not_renamed_to_new_measured_son(self):
        """Existing measured father is not renamed to new measured son."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Son", "33333333", "7", 20]],
            measurements=[[7, fixture.date, "Son", "33333333", 30]])
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Existing family test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
            cur.execute("INSERT INTO customers(name,mobile_no) VALUES('Father','+97333333333') RETURNING id")
            father = cur.fetchone()[0]
            cur.execute("INSERT INTO measurements(customer_id,chest) VALUES(%s,42)", (father,))
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT name FROM customers ORDER BY name")
            self.assertEqual(cur.fetchall(), [("Father",), ("Son",)])
            cur.execute("SELECT name FROM customers WHERE id=%s", (father,))
            self.assertEqual(cur.fetchone()[0], "Father")

    def test_chosen_unmeasured_name_reuses_an_existing_single_contact(self):
        """Chosen unmeasured name reuses an existing single contact."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(
            invoices=[[101, fixture.date, "Ali", "33333333", None, 30],
                      [102, fixture.date, "Aly", "33333333", None, 20]], measurements=[])
        apply_customer_identity(workbook, CustomerIdentity([
            {"phone": "33333333", "names": ["Ali", "Aly"], "decision": "name", "name": "Ali Ahmed"}
        ], canon_key))
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name,produces_orders) VALUES('Rename contact test',TRUE) RETURNING id")
            branch = cur.fetchone()[0]
            cur.execute("INSERT INTO customers(name,mobile_no) VALUES('Ali','+97333333333') RETURNING id,customer_number")
            customer_id, number = cur.fetchone()
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id,name,customer_number FROM customers")
            self.assertEqual(cur.fetchall(), [(customer_id, "Ali Ahmed", number)])

    def test_import_reserves_unused_numbers_and_never_rewinds_the_sequence(self):
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(invoices=[], measurements=[
            [9179, fixture.date, "Customer", "33333333", 42],
            [6216, fixture.date, "CUSTOMER", "33333333", 40],
            [10000, fixture.date, None, None, 38],
        ])
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name, produces_orders) VALUES('Import test', TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        with self.conn.cursor() as cur:
            cur.execute("SELECT customer_number FROM customers")
            self.assertEqual(cur.fetchall(), [(9179,)])
            cur.execute("INSERT INTO customers(name, mobile_no) "
                        "VALUES('New app customer', '35555555') RETURNING customer_number")
            self.assertEqual(cur.fetchone()[0], 10001)
            # Even deleted/unused numbers must not be handed out again.
            cur.execute("DELETE FROM customers WHERE customer_number = 10001")
        perform_insert(self.conn, workbook, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO customers(name, mobile_no) "
                        "VALUES('Next app customer', '36666666') RETURNING customer_number")
            self.assertEqual(cur.fetchone()[0], 10002)

    def test_import_falls_back_when_legacy_number_is_owned_by_an_app_customer(self):
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read(invoices=[], measurements=[
            [1, fixture.date, "Incoming", "33333333", 42],
            [7, fixture.date, "Other incoming", "34444444", 40],
        ])
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name, produces_orders) VALUES('Import test', TRUE) RETURNING id")
            branch = cur.fetchone()[0]
            cur.execute("INSERT INTO customers(name, mobile_no) "
                        "VALUES('App customer', '35555555') RETURNING customer_number")
            self.assertEqual(cur.fetchone()[0], 1)
        perform_insert(self.conn, workbook, branch, report)
        self.assertEqual(report.numeric[
            "customers: legacy number already in use (automatic ID used)"
        ], 1)
        self.assertEqual(report.numeric["customers assigned automatic numbers"], 1)
        self.assertEqual(report.numeric["customers assigned legacy measurement numbers"], 1)
        with self.conn.cursor() as cur:
            cur.execute("SELECT name, customer_number FROM customers")
            self.assertEqual(dict(cur.fetchall()), {
                "App customer": 1, "Incoming": 8, "Other incoming": 7,
            })
            cur.execute("SELECT readable_measurement_id(c.customer_number, m.measurement_number) "
                        "FROM measurements m JOIN customers c ON c.id=m.customer_id "
                        "WHERE c.name='Incoming'")
            self.assertEqual(cur.fetchone()[0], "C-8-001")
        rerun = Report()
        perform_insert(self.conn, workbook, branch, rerun)
        self.assertEqual(rerun.numeric[
            "customers: legacy number already in use (automatic ID used)"
        ], 0)
        with self.conn.cursor() as cur:
            cur.execute("SELECT name, customer_number FROM customers")
            self.assertEqual(dict(cur.fetchall()), {
                "App customer": 1, "Incoming": 8, "Other incoming": 7,
            })
            cur.execute("INSERT INTO customers(name, mobile_no) "
                        "VALUES('Next app customer', '36666666') RETURNING customer_number")
            self.assertEqual(cur.fetchone()[0], 9)

    def test_later_workbook_falls_back_when_an_earlier_import_took_the_number(self):
        """Later workbook falls back when an earlier import took the number."""
        fixture = ReadWorkbookTests()
        fixture.setUp()
        self.addCleanup(fixture.tempdir.cleanup)
        workbook, report = fixture.read()
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO branch(name, produces_orders) VALUES('Import test', TRUE) RETURNING id")
            branch = cur.fetchone()[0]
        perform_insert(self.conn, workbook, branch, report)
        later_workbook, later_report = fixture.read(invoices=[], measurements=[
            [9, fixture.date, "Later customer", "35555555", 38],
        ])
        perform_insert(self.conn, later_workbook, branch, later_report)
        self.assertEqual(later_report.numeric[
            "customers: legacy number already in use (automatic ID used)"
        ], 1)
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, name, customer_number FROM customers ORDER BY id")
            customers = cur.fetchall()
            self.assertEqual({name: number for _, name, number in customers}, {
                "Sheet Customer": 9, "Later customer": 10,
            })
        perform_insert(self.conn, later_workbook, branch, Report())
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, name, customer_number FROM customers ORDER BY id")
            self.assertEqual(cur.fetchall(), customers)

    def test_seed_sets_all_emd_prices_and_preserves_staff_changes(self):
        seed = (self.root / "backend/seeds/design_options.sql").read_text()
        with self.conn.cursor() as cur:
            cur.execute(seed)
            cur.execute("SELECT count(*), min(cost), max(cost) FROM design_options "
                        "WHERE category = 'emd'")
            self.assertEqual(cur.fetchone(), (27, Decimal("5.00"), Decimal("5.00")))
            cur.execute("SELECT count(*) FROM design_options WHERE category <> 'emd' AND cost <> 0")
            self.assertEqual(cur.fetchone()[0], 0)
            cur.execute("UPDATE design_options SET cost = 7 WHERE category = 'emd' AND slug = '1'")
            cur.execute(seed)
            cur.execute("SELECT count(*), count(*) FILTER (WHERE cost = 5), "
                        "count(*) FILTER (WHERE cost = 7) FROM design_options WHERE category = 'emd'")
            self.assertEqual(cur.fetchone(), (27, 26, 1))


if __name__ == "__main__":
    unittest.main()
