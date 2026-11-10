"""Parsing diagnostics identify every affected source cell without database access."""
import csv
import datetime as dt
import io
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import openpyxl

from ingest_xlsm import Report, main, parse_money, read_workbook


class ParsingReportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.path = self.directory / "orders.xlsm"
        self.date = dt.datetime(2026, 5, 1)
        self.book = openpyxl.Workbook()
        self.addCleanup(self.book.close)
        self.book.active.title = "New"
        self.book["New"].append([
            "Invoice", "Invoice Date", "Name", "Telephone", "Measurement No",
            "Final Amount", "Discount", "Adavance", "INCL. VAT AMT",
            "Delivery Date", "Approval By Mess Date",
        ])
        self.book.create_sheet("Measurments").append([
            "Measurement No", "Date", "Customer Name", "Customer Telephone", "Chest", "Hips",
        ])
        self.book.create_sheet("Repairing").append([
            "RECEIPT DATE", "Measurement No", " INCL. VAT AMT", "Name", "Telephone",
            "RECEIVED     DATE",
        ])

    def read(self):
        self.book.save(self.path)
        report = Report()
        return read_workbook(self.path, report), report

    def csv_rows(self, path):
        """Read the complete parsing report as UTF-8 CSV records."""
        with path.open(encoding="utf-8-sig", newline="") as source:
            return list(csv.DictReader(source))

    def test_keeps_every_issue_after_the_ten_console_samples(self):
        """Keeps every issue after the ten console samples."""
        sheet = self.book["Measurments"]
        sheet.append([None] * 6)
        for number in range(1, 16):
            sheet.append([number, self.date, f"Customer {number}", "33333333", "SHIRT"])
        workbook, report = self.read()
        self.assertEqual(len(report.parsing_issues), 15)
        self.assertEqual(sum(n for key, n in report.samples.items()
                             if key.startswith("Measurments: unparseable Chest:")), 10)
        self.assertEqual([r["row"] for r in report.parsing_issues], list(range(3, 18)))
        self.assertEqual(report.parsing_issues[-1]["cell"], "E17")
        self.assertEqual(len(workbook["measurements"]), 15)
        output = self.directory / "issues.csv"
        report.write_parsing_report(output)
        self.assertEqual(len(self.csv_rows(output)), 15)

    def test_multiple_bad_cells_include_owner_identifiers_and_original_values(self):
        """Multiple bad cells include owner identifiers and original values."""
        name = 'علي, "Ahmed"\nFamily'
        self.book["Measurments"].append([7, self.date, name, "33333333", "17-18", 45436])
        workbook, report = self.read()
        self.assertIsNone(workbook["measurements"][0]["values"]["chest"])
        self.assertIsNone(workbook["measurements"][0]["values"]["hip"])
        self.assertEqual([r["cell"] for r in report.parsing_issues], ["E2", "F2"])
        self.assertEqual(report.parsing_issues[1]["issue"], "Outside NUMERIC(7,3) range")
        output = self.directory / "issues.csv"
        report.write_parsing_report(output)
        rows = self.csv_rows(output)
        self.assertEqual(rows[0]["customer_name"], name)
        self.assertEqual(rows[0]["measurement_no"], "7")
        self.assertEqual(rows[0]["phone"], "33333333")
        self.assertEqual(rows[0]["raw_value"], "17-18")
        self.assertEqual(rows[1]["raw_value"], "45436")
        self.assertEqual(rows[0]["workbook"], str(self.path.resolve()))
        self.assertEqual(rows[0]["action"], "Value imported as NULL")
        self.assertTrue(output.read_bytes().startswith(b"\xef\xbb\xbf"))

    def test_invalid_numbers_and_missing_dates_identify_skipped_rows(self):
        """Invalid numbers and missing dates identify skipped rows."""
        self.book["New"].append(["bad-invoice", self.date, "Receipt", "33333333", 7, 20])
        self.book["New"].append([101, "bad-date", "Receipt", "33333333", 7, 20])
        self.book["New"].append([None, self.date, "Receipt", "33333333", 7, 20])
        self.book["Measurments"].append(["bad-number", self.date, "Sheet", "33333333", 42])
        workbook, report = self.read()
        self.assertEqual(workbook["invoices"], [])
        self.assertEqual(workbook["measurements"], [])
        self.assertEqual({(r["sheet"], r["cell"]) for r in report.parsing_issues},
                         {("New", "A2"), ("New", "B3"), ("New", "A4"), ("Measurments", "A2")})
        self.assertTrue(all(r["action"] == "Row skipped" for r in report.parsing_issues))
        self.assertEqual(report.parsing_issues[0]["invoice_number"], "bad-invoice")

    def test_duplicate_number_reports_the_selected_source_row(self):
        self.book["Measurments"].append([7, dt.datetime(2026, 1, 1), "Customer", "33333333", "old-bad-value"])
        self.book["Measurments"].append([None] * 6)
        self.book["Measurments"].append([7, self.date, "Customer", "33333333", "selected-bad-value"])
        _, report = self.read()
        self.assertEqual(len(report.parsing_issues), 1)
        self.assertEqual(report.parsing_issues[0]["cell"], "E4")
        self.assertEqual(report.parsing_issues[0]["raw_value"], "selected-bad-value")

    def test_bad_money_reports_fallbacks_and_valid_repair_charge_is_preserved(self):
        """Bad money reports fallbacks and valid repair charge is preserved."""
        self.book["New"].append([101, self.date, "Receipt", "33333333", 7,
                                 "bad-final", "NaN", "bad-advance", "12.50"])
        self.book["Repairing"].append([self.date, 7, "bad-charge", "Repair", "33333333"])
        self.book["Repairing"].append([self.date, 8, "2.50", "Repair", "33333333"])
        workbook, report = self.read()
        invoice = workbook["invoices"][0]
        self.assertEqual((invoice["final"], invoice["discount"], invoice["advance"]),
                         (Decimal("12.50"), Decimal("0"), Decimal("0")))
        self.assertEqual([r["charge"] for r in workbook["repairs"]], [Decimal("0"), Decimal("2.50")])
        self.assertEqual(len(report.parsing_issues), 4)
        repair = next(r for r in report.parsing_issues if r["sheet"] == "Repairing")
        self.assertEqual((repair["cell"], repair["raw_value"]), ("C2", "bad-charge"))
        self.assertEqual(repair["action"], "Repair charge defaults to 0")

    def test_bad_dates_report_the_existing_placeholder_or_skip_behavior(self):
        """Bad dates report the existing placeholder or skip behavior."""
        self.book["New"].append([101, self.date, "Receipt", "33333333", 7, 20,
                                 0, 0, None, "bad-delivery", "bad-approval"])
        self.book["Measurments"].append([7, "bad-date", "Sheet", "33333333", 42])
        self.book["Repairing"].append(["bad-receipt-date", 7, 0])
        self.book["Repairing"].append([self.date, 7, 0, None, None, "bad-completion"])
        self.book["Repairing"].append([dt.datetime(2025, 1, 1), 7, "ignored-old-charge"])
        workbook, report = self.read()
        self.assertEqual(workbook["measurements"][0]["measurement_date"], dt.date(2026, 1, 1))
        self.assertEqual(len(workbook["repairs"]), 1)
        self.assertEqual(len(report.parsing_issues), 5)
        self.assertEqual({r["raw_value"] for r in report.parsing_issues},
                         {"bad-delivery", "bad-approval", "bad-date", "bad-receipt-date", "bad-completion"})

    def test_invalid_references_and_misspelled_repair_sheet_keep_source_locations(self):
        """Invalid references and misspelled repair sheet keep source locations."""
        self.book["New"].append([101, self.date, "Receipt", "33333333", "bad-reference", 20])
        self.book["Repairing"].title = "Reparing"
        self.book["Reparing"].append([self.date, "bad-reference", 0])
        workbook, report = self.read()
        self.assertEqual(workbook["invoices"][0]["meas_nos"], [])
        self.assertEqual(workbook["repairs"][0]["meas_nos"], [])
        self.assertEqual({(r["sheet"], r["cell"]) for r in report.parsing_issues},
                         {("New", "E2"), ("Reparing", "B2")})

    def test_valid_fractions_and_optional_blanks_are_not_issues(self):
        self.book["Measurments"].append([7, None, "Sheet", "33333333", "42 1/2", "55⅜"])
        self.book["New"].append([101, self.date, "Receipt", "33333333", 7, "20.50"])
        _, report = self.read()
        self.assertEqual(report.parsing_issues, [])

    def test_clean_run_replaces_previous_issues_with_header_only(self):
        output = self.directory / "issues.csv"
        self.book["Measurments"].append([7, self.date, "Sheet", "33333333", "SHIRT"])
        _, report = self.read()
        report.write_parsing_report(output)
        self.assertEqual(len(self.csv_rows(output)), 1)
        self.book["Measurments"]["E2"] = 42
        _, report = self.read()
        report.write_parsing_report(output)
        self.assertEqual(self.csv_rows(output), [])
        self.assertIn("raw_value", output.read_text(encoding="utf-8-sig"))

    def test_failed_report_write_preserves_previous_report(self):
        """Failed report write preserves previous report."""
        output = self.directory / "issues.csv"
        output.write_text("previous report")
        with patch("ingest_xlsm.os.replace", side_effect=OSError("write failed")):
            with self.assertRaises(OSError):
                Report().write_parsing_report(output)
        self.assertEqual(output.read_text(), "previous report")
        self.assertEqual(list(self.directory.glob("issues.csv.*")), [])

    def test_dry_run_writes_full_report_without_database_access(self):
        """Dry run writes full report without database access."""
        self.book["Measurments"].append([7, self.date, "Sheet", "33333333", "SHIRT"])
        self.book.save(self.path)
        report_path = self.directory / "issues.csv"
        decisions = self.directory / "decisions.json"
        arguments = ["ingest", "--workbook", str(self.path), "--dry-run",
                     "--customer-decisions", str(decisions), "--parsing-report", str(report_path)]
        output = io.StringIO()
        with patch("sys.argv", arguments), patch("sys.stdout", output), \
                patch("ingest_xlsm.psycopg2.connect") as connect:
            self.assertEqual(main(), 0)
        connect.assert_not_called()
        self.assertEqual(self.csv_rows(report_path)[0]["cell"], "E2")
        self.assertIn("1 issues in 1 rows", output.getvalue())
        self.assertIn(str(report_path.resolve()), output.getvalue())

    def test_report_cannot_overwrite_workbook_or_customer_files(self):
        """Report cannot overwrite workbook or customer files."""
        decisions = self.directory / "decisions.json"
        review = self.directory / "review.json"
        for destination in (self.path, decisions, review):
            with self.subTest(destination=destination):
                arguments = ["ingest", "--dry-run", "--workbook", str(self.path),
                             "--customer-decisions", str(decisions), "--customer-review", str(review),
                             "--parsing-report", str(destination)]
                with patch("sys.argv", arguments), patch("sys.stderr", io.StringIO()), \
                        patch("ingest_xlsm.read_workbook") as read:
                    with self.assertRaises(SystemExit) as error:
                        main()
                self.assertEqual(error.exception.code, 2)
                read.assert_not_called()

    def test_nonfinite_and_invalid_money_can_be_reported_instead_of_raising(self):
        """Nonfinite and invalid money can be reported instead of raising."""
        for value in (float("nan"), float("inf"), Decimal("Infinity"), "NaN", "bad", True):
            with self.subTest(value=value):
                self.assertIsNone(parse_money(value))
