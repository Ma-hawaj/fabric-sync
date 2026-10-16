"""Workbook-reading regressions; run with unittest discover -s scripts."""

import datetime as dt
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import openpyxl

from ingest_xlsm import Report, read_workbook


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


if __name__ == "__main__":
    unittest.main()
