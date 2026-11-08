"""Measurement-number separation rules and portable decision evidence."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from customer_identity import (CustomerIdentity, canon_key, is_automatic_decision,
                               load_identity, save_review)
from review_customers import pending_pairs, record_decisions, review


PHONE = "+97333333333"


def record(name, number, phone=PHONE):
    return {"name": name, "phone": phone, "measurementNo": number,
            "date": "2026-11-08", "values": {"chest": "42"}}


class MeasurementNumberIdentityTests(unittest.TestCase):
    def policy(self, left, right, decisions=None):
        identity = CustomerIdentity(decisions or [], canon_key)
        records = [record("Father", n) for n in left] + [record("Son", n) for n in right]
        identity.configure_phones([("Father", PHONE), ("Son", PHONE)], records)
        return identity

    def test_gaps_one_through_five_are_different_in_either_direction(self):
        for a, b in [(100, 101), (100, 105), (105, 100), (101, 100)]:
            with self.subTest(numbers=(a, b)):
                identity = self.policy([a], [b])
                row, = identity.review([])
                self.assertTrue(is_automatic_decision(row))
                self.assertEqual(row["measurement_nos"], [a, b])
                self.assertEqual(row["measurement_no_difference"], abs(a - b))
                self.assertNotEqual(identity.key("Father", PHONE), identity.key("Son", PHONE))

    def test_equal_distant_missing_or_invalid_numbers_still_need_review(self):
        for a, b in [(100, 100), (100, 106), (None, 101), (0, 1), (-1, 1), (True, 2), (100, "105")]:
            with self.subTest(numbers=(a, b)):
                row, = self.policy([a], [b]).review([])
                self.assertEqual(row["decision"], "pending")
                self.assertNotIn("rule", row)

    def test_any_close_snapshot_can_identify_a_separate_person(self):
        row, = self.policy([100, 1000], [105, 9000]).review([])
        self.assertTrue(is_automatic_decision(row))
        self.assertEqual(row["measurement_nos"], [100, 105])
        self.assertEqual(len(row["measurements"]), 4)

    def test_repeat_measurements_with_one_normalized_name_are_not_split(self):
        identity = CustomerIdentity([], canon_key)
        identity.configure_phones([("Father", PHONE)], [record("Father", 100), record("FATHER", 101)])
        self.assertEqual(identity.review([]), [])

    def test_rule_is_scoped_to_shared_phones(self):
        identity = CustomerIdentity([], canon_key)
        identity.configure_phones([("Father", PHONE), ("Son", "+97334444444")],
                                  [record("Father", 100), record("Son", 101, "+97334444444")])
        self.assertEqual(identity.review([]), [])

    def test_explicit_answers_override_the_automatic_rule(self):
        for answer in ["same", "different"]:
            with self.subTest(answer=answer):
                decision = {"phone": PHONE, "names": ["Father", "Son"], "decision": answer}
                identity = self.policy([100], [101], [decision])
                self.assertEqual(identity.review([]), [])
                self.assertEqual(identity.key("Father", PHONE) == identity.key("Son", PHONE), answer == "same")

    def test_automatic_evidence_is_saved_portable_and_refreshed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.json"
            save_review(path, self.policy([100], [105]), [])
            first = path.read_bytes()
            saved, = json.loads(first)
            self.assertTrue(is_automatic_decision(saved))
            production = load_identity(path, canon_key)
            production.configure_phones([("Father", PHONE), ("Son", PHONE)],
                                        [record("Father", 100), record("Son", 105)])
            self.assertEqual(production.review([]), [saved])
            save_review(path, production, [])
            self.assertEqual(path.read_bytes(), first)
            production.configure_phones([("Father", PHONE), ("Son", PHONE)],
                                        [record("Father", 100), record("Son", 106)])
            save_review(path, production, [])
            row, = json.loads(path.read_text())
            self.assertEqual(row["decision"], "pending")
            self.assertNotIn("rule", row)

    def test_explicit_alias_can_override_previously_saved_automatic_evidence(self):
        automatic, = self.policy([100], [101]).review([])
        same = {"phone": PHONE, "names": ["Father", "Son"], "decision": "same"}
        identity = self.policy([100], [101], [automatic, same])
        self.assertEqual(identity.review([]), [])
        self.assertEqual(identity.key("Father", PHONE), identity.key("Son", PHONE))

    def test_reviewer_refreshes_old_pending_metadata_without_a_question(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.json"
            automatic, = self.policy([100], [101]).review([])
            old = {k: v for k, v in automatic.items()
                   if k not in {"rule", "measurement_nos", "measurement_no_difference"}}
            old["decision"] = "pending"
            path.write_text(json.dumps([old]))
            output = []
            self.assertEqual(review(path, input_fn=lambda _: self.fail("No question expected"),
                                    output_fn=output.append), 0)
            saved, = json.loads(path.read_text())
            self.assertTrue(is_automatic_decision(saved))
            self.assertEqual(pending_pairs(load_identity(path, canon_key)), [])
            self.assertTrue(any("Automatically separated pairs: 1" in line for line in output))

    def test_reviewer_keeps_automatic_evidence_when_other_pairs_are_answered(self):
        identity = self.policy([100], [101])
        records = [record("Father", 100), record("Son", 101), record("Alias", 200)]
        identity.configure_phones([(r["name"], r["phone"]) for r in records], records)
        loaded = CustomerIdentity(identity.review([]), canon_key)
        answer = {**pending_pairs(loaded)[0], "decision": "different"}
        updated = record_decisions(loaded, [answer])
        self.assertEqual(sum(is_automatic_decision(r) for r in updated.decisions), 1)
        self.assertEqual(len(pending_pairs(updated)), 1)

    def test_alias_resolution_rechecks_numbers_across_all_merged_snapshots(self):
        records = [record("Alias", 100), record("Father", 1000), record("Son", 105)]
        identity = CustomerIdentity([], canon_key)
        identity.configure_phones([(r["name"], r["phone"]) for r in records], records)
        loaded = CustomerIdentity(identity.review([]), canon_key)
        answer = next(r for r in pending_pairs(loaded) if r["names"] == ["alias", "father"])
        updated = record_decisions(loaded, [{**answer, "decision": "same"}])
        self.assertEqual(pending_pairs(updated), [])
        automatic = [r for r in updated.decisions if is_automatic_decision(r)]
        self.assertEqual(len(automatic), 1)
        self.assertEqual({r["measurementNo"] for r in automatic[0]["measurements"]}, {100, 1000, 105})

    def test_external_file_edits_are_protected_during_automatic_saving(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.json"
            automatic, = self.policy([100], [101]).review([])
            automatic["decision"] = "pending"
            path.write_text(json.dumps([automatic]))
            original = path.read_bytes()
            with patch.object(Path, "read_bytes", side_effect=[original, b"[]\n"]):
                with self.assertRaisesRegex(ValueError, "changed outside this session"):
                    review(path, input_fn=lambda _: self.fail("No question expected"), output_fn=lambda _: None)
            self.assertEqual(path.read_bytes(), original)
