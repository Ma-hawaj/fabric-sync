"""Phone grouping and measured-profile review rules."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from customer_identity import CustomerIdentity, canon_key, load_identity, save_review
from ingest_xlsm import (MEASUREMENT_VALUE_COLS, Report, apply_customer_identity,
                         customer_display, customer_key, invoice_customer_key, perform_insert)


def choice(name="Chosen customer", phone="33333333"):
    return {"phone": phone, "names": ["Alias A", "Alias B"], "name": name, "decision": "name"}


def measured(name, number=7, chest="42", phone="33333333"):
    return {"name": name, "phone": phone, "measurementNo": number,
            "date": "2026-11-07", "values": {"chest": chest}}


class PhonePolicyTests(unittest.TestCase):
    def test_unmeasured_names_only_need_one_name_choice(self):
        policy = CustomerIdentity([], canon_key)
        identities = [(name, "33333333") for name in ["Ali", "Aly", "Ali Ahmed"]]
        policy.configure_phones(identities, [])
        rows = policy.review(identities)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["decision"], "name_pending")
        self.assertEqual(rows[0]["names"], ["Ali", "Aly", "Ali Ahmed"])
        self.assertEqual(len({policy.key(n, p) for n, p in identities}), 1)

    def test_chosen_name_is_portable_and_applies_to_all_receipt_aliases(self):
        identities = [(name, "33333333") for name in ["Alias A", "Alias B"]]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.json"
            path.write_text(json.dumps([choice()]))
            policy = load_identity(path, canon_key)
            policy.configure_phones(identities, [])
            save_review(path, policy, identities)
            copied = load_identity(path, canon_key)
            copied.configure_phones(identities + [("New spelling", "33333333")], [])
            for name, phone in identities + [("New spelling", "33333333")]:
                self.assertEqual(copied.key(name, phone), canon_key("Chosen customer", "33333333"))
            self.assertEqual(copied.review(identities), [])

    def test_one_measured_identity_wins_without_any_review(self):
        policy = CustomerIdentity([choice()], canon_key)
        names = [(name, "33333333") for name in ["Measurement name", "Alias A", "Alias B"]]
        policy.configure_phones(names, [measured("Measurement name")])
        self.assertEqual({policy.key(n, p) for n, p in names}, {canon_key("Measurement name", "33333333")})
        self.assertEqual(policy.review(names), [])

    def test_last_measurement_spelling_wins_over_older_spelling_and_database_name(self):
        policy = CustomerIdentity([], canon_key)
        names = [("Ali", "33333333")]
        policy.configure_phones(names, [measured("Ali", 7), measured("ALI", 20),
                                       {**measured("Ali", None), "source": "database"}])
        self.assertEqual(policy.display_name(canon_key("Ali", "33333333"), "Fallback"), "ALI")
        self.assertEqual(policy.review(names), [])

    def test_only_multiple_measured_identities_need_verification(self):
        policy = CustomerIdentity([], canon_key)
        names = [(name, "33333333") for name in ["Father", "Son"]]
        records = [measured("Father", 7, "42"), measured("Son", 13, "30")]
        policy.configure_phones(names, records)
        review = policy.review(names)
        self.assertEqual(len(review), 1)
        self.assertEqual(review[0]["decision"], "pending")
        self.assertEqual([r["measurementNo"] for r in review[0]["measurements"]], [7, 13])
        self.assertNotEqual(policy.key("Father", "33333333"), policy.key("Son", "33333333"))

    def test_identical_values_do_not_automatically_merge_different_measured_names(self):
        policy = CustomerIdentity([], canon_key)
        names = [(n, "33333333") for n in ["Ali", "Aly"]]
        policy.configure_phones(names, [measured("Ali", 7), measured("Aly", 20)])
        self.assertEqual(len(policy.review(names)), 1)
        self.assertNotEqual(policy.key("Ali", "33333333"), policy.key("Aly", "33333333"))

    def test_repeat_snapshots_under_one_identity_do_not_add_identity_questions(self):
        policy = CustomerIdentity([], canon_key)
        names = [(n, "33333333") for n in ["Ali", "Alias"]]
        policy.configure_phones(names, [measured("Ali", 7), measured("Ali", 8, "43")])
        self.assertEqual(policy.review(names), [])
        self.assertEqual(policy.key("Ali", "33333333"), policy.key("Alias", "33333333"))

    def test_explicit_same_and_different_answers_are_reused(self):
        names = [(n, "33333333") for n in ["Ali", "Aly"]]
        records = [measured("Ali"), measured("Aly", 8)]
        for answer in ["same", "different"]:
            with self.subTest(answer=answer):
                policy = CustomerIdentity([{"phone": "33333333", "names": ["Ali", "Aly"], "decision": answer}], canon_key)
                policy.configure_phones(names, records)
                self.assertEqual(policy.review(names), [])
                self.assertEqual(policy.key("Ali", "33333333") == policy.key("Aly", "33333333"), answer == "same")

    def test_name_choice_does_not_merge_measured_family_members(self):
        policy = CustomerIdentity([choice("Father")], canon_key)
        names = [(n, "33333333") for n in ["Father", "Son", "Alias A", "Alias B"]]
        policy.configure_phones(names, [measured("Father"), measured("Son", 8, "30")])
        self.assertEqual(policy.key("Alias A", "33333333"), policy.key("Father", "33333333"))
        self.assertNotEqual(policy.key("Father", "33333333"), policy.key("Son", "33333333"))
        self.assertEqual([r["decision"] for r in policy.review(names)], ["different"])

    def test_multiple_measured_customers_only_allow_measured_owners_for_receipt_contacts(self):
        for contacts in [["Alias A"], ["Alias A", "Alias B"]]:
            for decisions in [[], [choice("Old unmeasured name")]]:
                with self.subTest(contacts=contacts, decisions=decisions):
                    policy = CustomerIdentity(decisions, canon_key)
                    names = [(n, "33333333") for n in ["Father", "Son", *contacts]]
                    policy.configure_phones(names, [measured("Father", 7), measured("Son", 8, "30")])
                    question, = policy.name_questions
                    self.assertEqual(question["names"], ["Father", "Son"])
                    self.assertEqual(question["measurement_names"], ["Father", "Son"])
                    self.assertEqual(question["contact_names"], contacts)
                    measured_keys = {canon_key(n, "33333333") for n in ["Father", "Son"]}
                    self.assertTrue(all(policy.key(n, "33333333") in measured_keys for n in contacts))

    def test_saved_measured_selection_stays_valid_after_new_receipt_spellings(self):
        policy = CustomerIdentity([choice("Son")], canon_key)
        names = [(n, "33333333") for n in ["Father", "Son", "Alias A", "New receipt spelling"]]
        policy.configure_phones(names, [measured("Father", 7), measured("Son", 8, "30")])
        self.assertEqual(policy.name_questions, [])
        self.assertEqual(policy.key("New receipt spelling", "33333333"), canon_key("Son", "33333333"))
        self.assertNotEqual(policy.key("Father", "33333333"), policy.key("Son", "33333333"))

    def test_new_measurement_data_supersedes_an_old_contact_name_choice(self):
        policy = CustomerIdentity([choice("Old name")], canon_key)
        names = [(n, "33333333") for n in ["New measured name", "Alias A"]]
        policy.configure_phones(names, [measured("New measured name")])
        self.assertEqual(policy.key("Alias A", "33333333"), canon_key("New measured name", "33333333"))
        self.assertEqual(policy.review(names), [])

    def test_different_phone_numbers_stay_separate(self):
        policy = CustomerIdentity([choice()], canon_key)
        names = [("Alias A", "33333333"), ("Alias B", "33333333"), ("Alias A", "34444444")]
        policy.configure_phones(names, [])
        self.assertNotEqual(policy.key("Alias A", "33333333"), policy.key("Alias A", "34444444"))

    def test_invalid_or_conflicting_name_choices_are_rejected(self):
        for rows in [[{**choice(), "name": " "}], [choice(), choice("Other name")]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                CustomerIdentity(rows, canon_key)


class WorkbookPhonePolicyTests(unittest.TestCase):
    def workbook(self, measurements=None):
        return {"measurements": measurements or [], "invoices": [
            {"name": name, "phone": "+97333333333", "meas_nos": []} for name in ["Alias A", "Alias B"]]}

    def test_blank_measurement_rows_only_need_a_contact_name(self):
        row = {"name": "Sheet name", "phone": "33333333", "measurement_no": 7, "values": {"chest": None}}
        workbook = self.workbook([row])
        policy = CustomerIdentity([], canon_key)
        apply_customer_identity(workbook, policy)
        self.assertEqual([r["decision"] for r in policy.review([])], ["name_pending"])

    def test_a_linked_blank_row_does_not_remove_receipt_name_options(self):
        row = {"name": "Sheet name", "phone": "33333333", "measurement_no": 7, "values": {"chest": None}}
        workbook = self.workbook([row])
        for invoice in workbook["invoices"]:
            invoice["meas_nos"] = [7]
        policy = CustomerIdentity([], canon_key)
        apply_customer_identity(workbook, policy)
        question = policy.review([])[0]
        self.assertEqual(question["decision"], "name_pending")
        self.assertEqual(set(question["names"]), {"Sheet name", "Alias A", "Alias B"})

    def test_measured_database_customer_is_not_absorbed_by_a_new_sheet_profile(self):
        row = {"name": "Son", "phone": "33333333", "measurement_no": 7, "values": {"chest": 30}}
        workbook = {"measurements": [row], "invoices": []}
        state = {"customer_rows": [("Father", "+97333333333", "father-id")],
                 "measurement_sigs": {("father-id", "2026-01-01", tuple("NULL" for _ in MEASUREMENT_VALUE_COLS))}}
        policy = CustomerIdentity([], canon_key)
        apply_customer_identity(workbook, policy, state)
        self.assertNotEqual(customer_key(workbook, "Father", "33333333"), customer_key(workbook, "Son", "33333333"))
        self.assertEqual(len(policy.review([])), 1)

    def test_pending_name_choice_blocks_before_any_database_writes(self):
        workbook = self.workbook()
        conn = MagicMock()
        with patch("ingest_xlsm.load_db_state", return_value={"customer_rows": [], "measurement_sigs": set()}):
            with self.assertRaisesRegex(ValueError, "Choose a customer name"):
                perform_insert(conn, workbook, "branch", Report())
        conn.cursor.assert_not_called()

    def test_old_unmeasured_choice_cannot_create_an_extra_customer_when_measurements_exist(self):
        workbook = self.workbook([
            {"name": name, "phone": "33333333", "measurement_no": number, "values": {"chest": 42}}
            for name, number in [("Father", 7), ("Son", 8)]])
        apply_customer_identity(workbook, CustomerIdentity([choice()], canon_key))
        conn = MagicMock()
        with patch("ingest_xlsm.load_db_state", return_value={"customer_rows": [], "measurement_sigs": set()}):
            with self.assertRaisesRegex(ValueError, "Choose a customer name"):
                perform_insert(conn, workbook, "branch", Report())
        conn.cursor.assert_not_called()

    def test_chosen_name_is_the_display_for_the_shared_phone(self):
        workbook = self.workbook()
        apply_customer_identity(workbook, CustomerIdentity([choice()], canon_key))
        display, _ = customer_display(workbook, {})
        self.assertEqual(list(display.values()), [("Chosen customer", "+97333333333")])


class MeasurementReferenceLinkTests(unittest.TestCase):
    def workbook(self, contacts):
        return {"measurements": [
            {"measurement_no": number, "name": name, "phone": "+97333333333", "values": {"chest": chest}}
            for name, number, chest in [("Father", 7, 42), ("Son", 8, 30)]],
            "invoices": [{"name": name, "phone": phone, "meas_nos": numbers}
                         for name, phone, numbers in contacts]}

    def test_exact_references_link_unreferenced_receipts_for_each_contact(self):
        phone = "+97333333333"
        workbook = self.workbook([("Alias A", phone, [7]), ("Alias B", phone, [8]),
                                  ("Alias A", phone, []), ("Alias B", phone, [])])
        identity = CustomerIdentity([], canon_key)
        apply_customer_identity(workbook, identity)
        self.assertEqual(identity.name_questions, [])
        self.assertEqual(identity.key("Alias A", phone), identity.key("Father", phone))
        self.assertEqual(identity.key("Alias B", phone), identity.key("Son", phone))
        self.assertNotEqual(identity.key("Father", phone), identity.key("Son", phone))
        self.assertEqual({name for name, _ in customer_display(workbook, {})[0].values()}, {"Father", "Son"})

    def test_conflicting_references_and_family_receipts_still_need_a_choice(self):
        phone = "+97333333333"
        for references in [([7], [8], []), ([7, 8], []), ([7], [7, 8], [])]:
            with self.subTest(references=references):
                workbook = self.workbook([("Alias A", phone, numbers) for numbers in references])
                identity = CustomerIdentity([], canon_key)
                apply_customer_identity(workbook, identity)
                self.assertEqual(identity.measurement_links, {})
                question, = identity.name_questions
                self.assertEqual(question["contact_names"], ["Alias A"])
                self.assertEqual(question["names"], ["Father", "Son"])

    def test_missing_or_unusable_measurement_numbers_do_not_infer_links(self):
        phone = "+97333333333"
        for numbers in [[], [999], [9], [7, 999], [7, 9]]:
            with self.subTest(numbers=numbers):
                workbook = self.workbook([("Alias A", phone, numbers), ("Alias A", phone, [])])
                workbook["measurements"].append({"measurement_no": 9, "name": None, "phone": None,
                                                 "values": {"chest": None}})
                identity = CustomerIdentity([], canon_key)
                apply_customer_identity(workbook, identity)
                self.assertEqual(identity.measurement_links, {})
                self.assertEqual(identity.name_questions[0]["contact_names"], ["Alias A"])

    def test_reference_reuse_is_phone_scoped_and_does_not_remap_measured_people(self):
        phone = "+97333333333"
        other = "+97334444444"
        workbook = self.workbook([("Alias A", other, [7]), ("Alias A", other, []),
                                  ("Father", phone, [8]), ("Father", phone, [])])
        identity = CustomerIdentity([], canon_key)
        apply_customer_identity(workbook, identity)
        sources = {m["measurement_no"]: m for m in workbook["measurements"]}
        self.assertEqual(identity.measurement_links, {})
        self.assertEqual(identity.key("Alias A", other), canon_key("Alias A", other))
        self.assertEqual(identity.key("Father", phone), canon_key("Father", phone))
        self.assertEqual(invoice_customer_key(workbook, workbook["invoices"][0], sources),
                         canon_key("Father", phone))
        self.assertEqual(invoice_customer_key(workbook, workbook["invoices"][2], sources),
                         canon_key("Son", phone))

    def test_changed_workbook_recomputes_reference_links(self):
        phone = "+97333333333"
        workbook = self.workbook([("Alias A", phone, [7]), ("Alias A", phone, [])])
        identity = CustomerIdentity([], canon_key)
        apply_customer_identity(workbook, identity)
        self.assertEqual(identity.key("Alias A", phone), canon_key("Father", phone))
        workbook["invoices"][0]["meas_nos"] = [8]
        apply_customer_identity(workbook, identity)
        self.assertEqual(identity.key("Alias A", phone), canon_key("Son", phone))
        self.assertEqual(identity.name_questions, [])
        workbook["invoices"][0]["meas_nos"] = []
        apply_customer_identity(workbook, identity)
        self.assertEqual(identity.measurement_links, {})
        self.assertEqual(identity.name_questions[0]["contact_names"], ["Alias A"])

    def test_exact_reference_evidence_precedes_the_phone_group_fallback(self):
        phone = "+97333333333"
        workbook = self.workbook([("Alias A", phone, [8]), ("Alias A", phone, []), ("Alias B", phone, [])])
        identity = CustomerIdentity([choice("Father")], canon_key)
        apply_customer_identity(workbook, identity)
        self.assertEqual(identity.key("Alias A", phone), canon_key("Son", phone))
        self.assertEqual(identity.key("Alias B", phone), canon_key("Father", phone))

    def test_reference_linking_is_recomputed_with_the_same_saved_decisions_on_production(self):
        phone = "+97333333333"
        workbook = self.workbook([("Alias A", phone, [7]), ("Alias A", phone, []),
                                  ("Alias B", phone, [8]), ("Alias B", phone, [])])
        identity = CustomerIdentity([], canon_key)
        apply_customer_identity(workbook, identity)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.json"
            save_review(path, identity, [])
            original = path.read_bytes()
            production = load_identity(path, canon_key)
            apply_customer_identity(workbook, production)
            self.assertEqual(production.measurement_links, identity.measurement_links)
            self.assertEqual(production.name_questions, [])
            self.assertEqual(path.read_bytes(), original)
