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
from review_customers import pending_pairs, review


class InteractiveReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "decisions.json"
        self.output = []

    def seed(self, names=("Ali Ahmed", "Ali Ahmad", "Son"), phone="33333333"):
        save_review(self.path, CustomerIdentity([], canon_key), [(name, phone) for name in names])

    def run_review(self, answers, **options):
        answers = iter(answers)
        def read(_prompt):
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
        self.seed()
        self.run_review(["s", KeyboardInterrupt()])
        self.assertEqual(len(pending_pairs(self.policy())), 1)
        self.run_review(["d", "q"])
        self.assertEqual(pending_pairs(self.policy()), [])
        self.assertEqual({row["decision"] for row in self.policy().decisions}, {"same", "different"})

    def test_similarity_filter_leaves_other_pairs_pending(self):
        self.seed()
        self.run_review(["d", "q"], min_similarity=0.8)
        policy = self.policy()
        self.assertEqual(len(pending_pairs(policy)), 2)
        reviewed = [row for row in policy.decisions if row["decision"] != "pending"]
        self.assertEqual(reviewed[0]["names"], ["ali ahmad", "ali ahmed"])

    def test_external_edits_are_not_overwritten(self):
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
        original = b'[{"decision":"merge"}]'
        self.path.write_bytes(original)
        with self.assertRaises(ValueError):
            review(self.path, input_fn=lambda _prompt: "q", output_fn=self.output.append)
        self.assertEqual(self.path.read_bytes(), original)

    def test_failed_save_keeps_previous_answers(self):
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
        identities = [(name, phone) for name in names]
        policy = CustomerIdentity([], canon_key)
        policy.configure_phones(identities, [])
        save_review(self.path, policy, identities)

    def test_chooses_a_name_instead_of_asking_same_or_different(self):
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
        identities = [(name, "33333333") for name in ["Ali", "Aly", "Son"]]
        records = [{"name": name, "phone": "33333333", "measurementNo": i,
                    "date": "2026-11-07", "values": {"chest": str(42-i)}}
                   for i, (name, _) in enumerate(identities, 1)]
        policy = CustomerIdentity([], canon_key)
        policy.configure_phones(identities, records)
        save_review(self.path, policy, identities)
        self.run_review(["s", "q"])
        rows = pending_pairs(self.policy())
        self.assertEqual(len(rows), 1)
        self.assertEqual({r["measurementNo"] for r in rows[0]["measurements"]}, {1, 2, 3})
        self.assertTrue(any("Measurement No" in line for line in self.output))
