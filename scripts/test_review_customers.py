"""Interactive review tests; run without installed dependencies via python -S."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from customer_identity import CustomerIdentity, canon_key, save_review
from review_customers import pending_names, pending_pairs, record_name, review


class InteractiveReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "decisions.json"
        self.output = []

    def seed(self, names=("Ali Ahmed", "Ali Ahmad", "Son"), phone="33333333"):
        """Write the initial decisions and measurement context for an interactive review."""
        save_review(self.path, CustomerIdentity([], canon_key), [(name, phone) for name in names])

    def run_review(self, answers, **options):
        """Run the reviewer with scripted answers and capture its output."""
        answers = iter(answers)
        def read(_prompt):
            """Return the next scripted answer or raise the requested interruption."""
            answer = next(answers)
            if isinstance(answer, BaseException):
                raise answer
            return answer
        return review(self.path, input_fn=read, output_fn=self.output.append, **options)

    def policy(self):
        return CustomerIdentity(json.loads(self.path.read_text()), canon_key)

    def test_same_answer_is_saved_and_collapses_duplicate_pending_pairs(self):
        self.seed()
        self.run_review(["s", "q"])
        policy = self.policy()
        self.assertEqual(policy.key("Ali Ahmed", "33333333"), policy.key("Ali Ahmad", "33333333"))
        self.assertNotEqual(policy.key("Son", "33333333"), policy.key("Ali Ahmed", "33333333"))
        self.assertEqual(len(pending_pairs(policy)), 1)
        self.run_review(["q"])
        self.assertEqual(len(pending_pairs(self.policy())), 1)

    def test_skip_and_quit_leave_file_unchanged(self):
        self.seed()
        original = self.path.read_bytes()
        self.run_review(["k", "q"])
        self.assertEqual(self.path.read_bytes(), original)

    def test_bulk_different_requires_confirmation(self):
        self.seed()
        original = self.path.read_bytes()
        self.run_review(["a", "", "q"])
        self.assertEqual(self.path.read_bytes(), original)

    def test_bulk_only_marks_requested_phone_and_preserves_aliases(self):
        """Bulk only marks requested phone and preserves aliases."""
        self.seed()
        self.run_review(["s", "q"])
        rows = json.loads(self.path.read_text())
        rows.append({"phone": "34444444", "names": ["Father", "Son"], "decision": "pending"})
        self.path.write_text(json.dumps(rows))
        self.run_review(["a", "yes", "q"], phone="+97333333333")
        policy = self.policy()
        self.assertEqual(policy.key("Ali Ahmed", "33333333"), policy.key("Ali Ahmad", "33333333"))
        self.assertEqual([row["phone"] for row in pending_pairs(policy)], ["+97334444444"])
        self.assertTrue(any("son" in line for line in self.output))

    def test_undo_restores_file_even_after_last_pair(self):
        self.seed(names=("Ali Ahmed", "Ali Ahmad"))
        original = json.loads(self.path.read_text())
        self.run_review(["d", "u", "q"])
        self.assertEqual(json.loads(self.path.read_text()), original)

    def test_answers_survive_interruption_and_resume(self):
        """Answers survive interruption and resume."""
        self.seed()
        self.run_review(["s", KeyboardInterrupt()])
        self.assertEqual(len(pending_pairs(self.policy())), 1)
        self.run_review(["d", "q"])
        self.assertEqual(pending_pairs(self.policy()), [])
        self.assertEqual({row["decision"] for row in self.policy().decisions}, {"same", "different"})

    def test_similarity_filter_leaves_other_pairs_pending(self):
        """Similarity filter leaves other pairs pending."""
        self.seed()
        self.run_review(["d", "q"], min_similarity=0.8)
        policy = self.policy()
        self.assertEqual(len(pending_pairs(policy)), 2)
        reviewed = [row for row in policy.decisions if row["decision"] != "pending"]
        self.assertEqual(reviewed[0]["names"], ["ali ahmad", "ali ahmed"])

    def test_external_edits_are_not_overwritten(self):
        """External edits are not overwritten."""
        self.seed()
        other = b"[]\n"
        def external_edit(_prompt):
            self.path.write_bytes(other)
            return "d"
        with self.assertRaisesRegex(ValueError, "changed outside this session"):
            review(self.path, input_fn=external_edit, output_fn=self.output.append)
        self.assertEqual(self.path.read_bytes(), other)

    def test_invalid_input_does_not_make_decisions(self):
        self.seed()
        original = self.path.read_bytes()
        self.run_review(["merge", "q"])
        self.assertEqual(self.path.read_bytes(), original)

    def test_cli_runs_without_excel_or_database_dependencies(self):
        script = Path(__file__).with_name("review_customers.py")
        self.seed(names=("Father", "Son"))
        result = subprocess.run([sys.executable, "-S", str(script), "--customer-decisions", str(self.path)],
                                input="d\nq\n", text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(pending_pairs(self.policy()), [])
        self.assertIn("Saved 1 decision", result.stdout)

    def test_invalid_saved_decisions_do_not_change_file(self):
        """Invalid saved decisions do not change file."""
        original = b'[{"decision":"merge"}]'
        self.path.write_bytes(original)
        with self.assertRaises(ValueError):
            review(self.path, input_fn=lambda _prompt: "q", output_fn=self.output.append)
        self.assertEqual(self.path.read_bytes(), original)

    def test_failed_save_keeps_previous_answers(self):
        """Failed save keeps previous answers."""
        self.seed()
        original = self.path.read_bytes()
        with patch("customer_identity.os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.run_review(["s"])
        self.assertEqual(self.path.read_bytes(), original)


class PhoneNameReviewTests(unittest.TestCase):
    setUp = InteractiveReviewTests.setUp
    run_review = InteractiveReviewTests.run_review
    policy = InteractiveReviewTests.policy
    def seed(self, names=("Alias A", "Alias B"), phone="33333333"):
        """Write the initial decisions and measurement context for an interactive review."""
        identities = [(name, phone) for name in names]
        policy = CustomerIdentity([], canon_key)
        policy.configure_phones(identities, [])
        save_review(self.path, policy, identities)

    def test_chooses_a_name_instead_of_asking_same_or_different(self):
        """Chooses a name instead of asking same or different."""
        self.seed()
        self.run_review(["2", "q"])
        policy = self.policy()
        self.assertEqual(policy.preferred_names, {"+97333333333": "Alias B"})
        self.assertEqual(pending_pairs(policy), [])
        self.assertTrue(any("choose one name" in line for line in self.output))

    def test_custom_name_is_saved(self):
        self.seed()
        self.run_review(["n", "  Preferred customer  ", "q"])
        self.assertEqual(self.policy().preferred_names["+97333333333"], "Preferred customer")

    def test_skip_leaves_name_pending(self):
        self.seed()
        before = self.path.read_bytes()
        self.run_review(["k"])
        self.assertEqual(self.path.read_bytes(), before)

    def test_name_choice_can_be_undone(self):
        self.seed()
        before = self.path.read_bytes()
        self.run_review(["2", "u", "q"])
        self.assertEqual(self.path.read_bytes(), before)

    def test_similarity_filter_does_not_hide_required_name_choices(self):
        self.seed()
        self.run_review(["1", "q"], min_similarity=1)
        self.assertEqual(self.policy().preferred_names["+97333333333"], "Alias A")

    def test_measurement_context_survives_answer_and_save(self):
        """Measurement context survives answer and save."""
        identities = [(name, "33333333") for name in ["Ali", "Aly", "Son"]]
        records = [{"name": name, "phone": "33333333", "measurementNo": i * 10,
                    "date": "2026-11-07", "values": {"chest": str(42-i)}}
                   for i, (name, _) in enumerate(identities, 1)]
        policy = CustomerIdentity([], canon_key)
        policy.configure_phones(identities, records)
        save_review(self.path, policy, identities)
        self.run_review(["s", "q"])
        rows = pending_pairs(self.policy())
        self.assertEqual(len(rows), 1)
        self.assertEqual({r["measurementNo"] for r in rows[0]["measurements"]}, {10, 20, 30})
        self.assertTrue(any("Measurement No" in line for line in self.output))


class MeasuredCustomerReviewTests(unittest.TestCase):
    setUp = InteractiveReviewTests.setUp
    run_review = InteractiveReviewTests.run_review
    policy = InteractiveReviewTests.policy

    def seed(self, decision="name_pending"):
        """Write the initial decisions and measurement context for an interactive review."""
        row = {"phone": "+97333333333", "names": ["Receipt A", "Receipt B", "Father", "Son"],
               "decision": decision, "measurement_names": ["Father", "Son"]}
        if decision == "name":
            row["name"] = "Receipt A"
        self.path.write_text(json.dumps([row], indent=2) + "\n")

    def test_old_mixed_options_only_offer_measured_customers_and_reject_custom_names(self):
        """Old mixed options only offer measured customers and reject custom names."""
        self.seed()
        self.run_review(["n", "3", "2", "q"])
        self.assertEqual(self.policy().preferred_names, {"+97333333333": "Son"})
        self.assertEqual(pending_names(self.policy()), [])
        self.assertTrue(any("Contacts: Receipt A; Receipt B" in line for line in self.output))
        self.assertTrue(any("  1. Father" in line for line in self.output))
        self.assertFalse(any("  1. Receipt A" in line or "  3." in line for line in self.output))

    def test_previous_unmeasured_name_choice_is_reopened(self):
        self.seed(decision="name")
        self.run_review(["1", "q"])
        policy = self.policy()
        self.assertEqual(policy.preferred_names, {"+97333333333": "Father"})
        self.assertEqual(len(policy.decisions), 1)

    def test_saving_an_unmeasured_name_for_a_measured_group_is_rejected(self):
        """Saving an unmeasured name for a measured group is rejected."""
        self.seed()
        policy = self.policy()
        row, = pending_names(policy)
        for name in ["Receipt A", "Custom person"]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "measured customers"):
                record_name(policy, row, name)

    def test_skip_and_undo_preserve_required_measured_selection(self):
        self.seed()
        original = self.path.read_bytes()
        self.run_review(["k"])
        self.assertEqual(self.path.read_bytes(), original)
        self.run_review(["2", "u", "q"])
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(pending_names(self.policy())[0]["names"], ["Father", "Son"])
