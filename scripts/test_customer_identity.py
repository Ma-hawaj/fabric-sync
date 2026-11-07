import contextlib
import io
import json
import tempfile
from pathlib import Path

import unittest
from unittest.mock import MagicMock, patch

from customer_identity import CustomerIdentity, load_identity, save_review
from ingest_xlsm import (Report, apply_customer_identity, canon_key, customer_key,
                         legacy_customer_numbers, main, perform_insert)


class CustomerIdentityTests(unittest.TestCase):
    def policy(self, rows):
        return CustomerIdentity(rows, canon_key)

    def decision(self, left, right, decision="same"):
        return {"phone": "33333333", "names": [left, right], "decision": decision}

    def test_only_explicit_aliases_merge_and_are_phone_scoped(self):
        policy = self.policy([self.decision("Ali Ahmed", "Ali Ahmad")])
        self.assertEqual(policy.key("ALI  AHMAD", "+97333333333"),
                         canon_key("Ali Ahmed", "33333333"))
        self.assertNotEqual(policy.key("Ali Ahmed", "33333333"),
                            policy.key("Ali Junior", "33333333"))
        self.assertEqual(policy.key("Ali Ahmad", "34444444"),
                         canon_key("Ali Ahmad", "34444444"))

    def test_transitive_aliases_and_conflicts(self):
        rows = [self.decision("A", "B"), self.decision("B", "C")]
        policy = self.policy(rows)
        self.assertEqual(policy.key("C", "33333333"), canon_key("A", "33333333"))
        with self.assertRaises(ValueError):
            self.policy(rows + [self.decision("A", "C", "different")])

    def test_review_skips_saved_decisions_and_keeps_pending_separate(self):
        policy = self.policy([self.decision("Father", "Son", "different"),
                              self.decision("Father", "Fatherr", "pending")])
        review = policy.review([(n, "33333333") for n in ["Father", "Son", "Fatherr"]])
        self.assertEqual(len(review), 2)
        self.assertEqual(review[0]["names"], ["father", "fatherr"])
        self.assertNotEqual(policy.key("Father", "33333333"), policy.key("Fatherr", "33333333"))

    def test_measurements_and_legacy_numbers_use_same_resolver(self):
        policy = self.policy([self.decision("Ali", "Aly")])
        workbook = {"invoices": [{"name": "Ali", "phone": "33333333", "meas_nos": [12]}],
                    "measurements": [{"name": "Aly", "phone": "33333333", "measurement_no": 12}]}
        apply_customer_identity(workbook, policy)
        key = customer_key(workbook, "Ali", "33333333")
        self.assertEqual(workbook["measurements"][0]["key"], key)
        self.assertEqual(legacy_customer_numbers(workbook, Report())[0], {key: 12})

    def test_existing_duplicate_records_block_before_writes(self):
        workbook = {"customer_identity": self.policy([self.decision("Ali", "Aly")])}
        conn = MagicMock()
        with patch("ingest_xlsm.load_db_state", return_value={"customer_rows": [
                ("Ali", "33333333", "id1"), ("Aly", "33333333", "id2")]}):
            with self.assertRaisesRegex(ValueError, "Multiple existing customers"):
                perform_insert(conn, workbook, "branch", Report())
        conn.cursor.assert_not_called()

    def test_invalid_decisions_rejected(self):
        for rows in [{}, [{"decision": "merge"}], [self.decision("Ali", "ALI")]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                self.policy(rows)


class SavedDecisionTests(unittest.TestCase):
    def test_dry_run_file_can_be_reviewed_copied_and_reloaded(self):
        identities = [(name, "33333333") for name in ["Ali Ahmed", "Ali Ahmad", "Son"]]
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / "local.json"
            prod = Path(directory) / "prod.json"
            save_review(local, CustomerIdentity([], canon_key), identities)
            rows = json.loads(local.read_text())
            self.assertEqual(len(rows), 3)
            rows[0]["decision"] = "same"
            rows[1]["decision"] = "different"
            local.write_text(json.dumps(rows))
            policy = load_identity(local, canon_key)
            save_review(local, policy, identities)
            first_refresh = local.read_bytes()
            save_review(local, load_identity(local, canon_key), identities)
            self.assertEqual(local.read_bytes(), first_refresh)
            prod.write_bytes(first_refresh)
            production = load_identity(prod, canon_key)
            self.assertEqual(production.key("Ali Ahmad", "33333333"),
                             production.key("Ali Ahmed", "33333333"))
            self.assertNotEqual(production.key("Son", "33333333"),
                                production.key("Ali Ahmed", "33333333"))
            self.assertEqual(len(production.review(identities)), 0)

    def test_failed_save_preserves_previous_decisions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.json"
            path.write_text("[]\n")
            with patch("customer_identity.os.replace", side_effect=OSError("write failed")):
                with self.assertRaises(OSError):
                    save_review(path, CustomerIdentity([], canon_key), [])
            self.assertEqual(path.read_text(), "[]\n")
            self.assertEqual(list(Path(directory).iterdir()), [path])


class DecisionCliTests(unittest.TestCase):
    def test_dry_run_creates_file_and_never_connects(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.json"
            workbook = {"invoices": [], "measurements": []}
            with patch("sys.argv", ["ingest", "--dry-run", "--customer-decisions", str(path)]), \
                    patch("ingest_xlsm.read_workbook", return_value=workbook), \
                    patch("ingest_xlsm.psycopg2.connect") as connect, \
                    contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(main(), 0)
            connect.assert_not_called()
            self.assertEqual(json.loads(path.read_text()), [])
            self.assertIn("SHA-256:", output.getvalue())

    def test_production_requires_decisions_before_reading_workbook(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.json"
            with patch("sys.argv", ["ingest", "--customer-decisions", str(path)]), \
                    patch("ingest_xlsm.read_workbook") as read, \
                    contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    main()
            self.assertEqual(error.exception.code, 2)
            read.assert_not_called()
