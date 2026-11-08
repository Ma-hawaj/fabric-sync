"""Phone-scoped contact names and measured identity decisions for ingestion."""
import itertools
import json
import os
import re
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

MEASUREMENT_GAP_RULE = "measurement_number_gap"
MAX_DISTINCT_MEASUREMENT_GAP = 5


def is_automatic_decision(row):
    return row.get("decision") == "different" and row.get("rule") == MEASUREMENT_GAP_RULE


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


class CustomerIdentity:
    def __init__(self, decisions, canonical_key):
        self.canonical_key = canonical_key
        self.parents = {}
        self.separate = set()
        self.preferred_names = {}
        self.phone_measured = None
        self.phone_defaults = {}
        self.labels = {}
        self.name_questions = []
        self.profile_records = {}
        if not isinstance(decisions, list):
            raise ValueError("Customer decisions must be a JSON list")
        self.decisions = decisions
        pairs = []
        for row in decisions:
            if not isinstance(row, dict):
                raise ValueError("Each decision must be a JSON object")
            decision = row.get("decision")
            if decision in {"name", "name_pending"}:
                phone = norm_phone(row.get("phone"))
                names = row.get("names", [row.get("name")])
                if not phone or not isinstance(names, list) or not names or not all(isinstance(n, str) and norm_name(n) for n in names):
                    raise ValueError("A name choice needs a phone and a list of names")
                if decision == "name":
                    chosen = norm_name(row.get("name"))
                    if not chosen:
                        raise ValueError("A saved name choice needs a non-empty name")
                    if phone in self.preferred_names and self.preferred_names[phone] != chosen:
                        raise ValueError("Conflicting preferred names for one phone")
                    self.preferred_names[phone] = chosen
                continue
            if decision not in {"same", "different", "pending"}:
                raise ValueError("Each decision must be same, different, pending, name, or name_pending")
            names = row.get("names")
            if not isinstance(names, list) or len(names) != 2 or not all(isinstance(n, str) for n in names):
                raise ValueError("Each identity decision needs exactly two names")
            keys = [canonical_key(n, row.get("phone")) for n in names]
            if not all(keys) or keys[0] == keys[1]:
                raise ValueError("Decisions need two distinct names and a phone")
            # Derived decisions are evidence, refreshed from measurement records.
            # Human answers take precedence, including a later explicit alias.
            if not is_automatic_decision(row):
                pairs.append((decision, *keys))
        for decision, left, right in pairs:
            if decision == "same":
                self.parents[self.resolve(right)] = self.resolve(left)
        for decision, left, right in pairs:
            if decision == "different":
                left, right = self.resolve(left), self.resolve(right)
                if left == right:
                    raise ValueError("Conflicting same/different customer decisions")
                self.separate.add(frozenset((left, right)))

    def resolve(self, key):
        while key in self.parents and self.parents[key] != key:
            key = self.parents[key]
        return key

    def base_key(self, name, phone):
        return self.resolve(self.canonical_key(name, phone))

    def configure_phones(self, identities, measurements):
        """Receipt-only names share a contact; measured people stay distinct."""
        self.phone_measured = {}
        self.phone_defaults = {}
        self.labels = {}
        self.name_questions = []
        self.profile_records = {}
        for record in measurements:
            key = self.base_key(record["name"], record["phone"])
            if key:
                self.phone_measured.setdefault(key[1], set()).add(key)
                self.labels.setdefault(key, record["name"])
                self.profile_records.setdefault(key, []).append(record)
        by_phone = {}
        for name, phone in identities:
            key = self.base_key(name, phone)
            if key:
                by_phone.setdefault(key[1], {}).setdefault(key, name)
        for phone, names in by_phone.items():
            measured = self.phone_measured.setdefault(phone, set())
            if len(measured) == 1:
                self.phone_defaults[phone] = next(iter(measured))
                continue
            unmeasured = {key: name for key, name in names.items() if key not in measured}
            if not unmeasured:
                continue
            chosen = self.preferred_names.get(phone)
            if chosen:
                key = self.base_key(chosen, phone)
                self.phone_defaults[phone] = key
                self.labels.setdefault(key, chosen)
            else:
                key = next(iter(unmeasured))
                self.phone_defaults[phone] = key
                self.labels.setdefault(key, unmeasured[key])
                if len(unmeasured) > 1:
                    options = list(dict.fromkeys([*unmeasured.values(),
                                                 *(self.labels[k] for k in sorted(measured))]))
                    self.name_questions.append({"phone": phone, "names": options,
                                                "decision": "name_pending",
                                                "measurement_names": [self.labels[k] for k in sorted(measured)]})

    def key(self, name, phone):
        key = self.base_key(name, phone)
        if key is None or self.phone_measured is None:
            return key
        measured = self.phone_measured.get(key[1], set())
        if key in measured:
            return key
        return self.phone_defaults.get(key[1], key)

    def display_name(self, key, fallback):
        return self.labels.get(key, fallback)

    def review_pair(self, left, right, records):
        left, right = self.resolve(left), self.resolve(right)
        if left == right or left[1] != right[1] or frozenset((left, right)) in self.separate:
            return None
        left, right = sorted((left, right))
        row = {"phone": left[1], "names": [left[0], right[0]], "decision": "pending",
               "name_similarity": round(SequenceMatcher(None, left[0], right[0]).ratio(), 3)}
        if records:
            row["measurements"] = records
        numbers = {left: set(), right: set()}
        for record in records:
            key = self.base_key(record["name"], record.get("phone", left[1]))
            number = record.get("measurementNo")
            if key in numbers and type(number) is int and number > 0:
                numbers[key].add(number)
        # Check a bounded window rather than every combination of snapshots.
        matches = [(abs(a - b), a, b) for a in numbers[left]
                   for b in range(max(1, a - MAX_DISTINCT_MEASUREMENT_GAP),
                                  a + MAX_DISTINCT_MEASUREMENT_GAP + 1)
                   if b != a and b in numbers[right]]
        if matches:
            gap, a, b = min(matches)
            row.update(decision="different", rule=MEASUREMENT_GAP_RULE,
                       measurement_nos=[a, b], measurement_no_difference=gap)
        return row

    def review(self, identities):
        if self.phone_measured is None:
            by_phone = {}
            for name, phone in identities:
                key = self.key(name, phone)
                if key:
                    by_phone.setdefault(key[1], set()).add(key[0])
        else:
            by_phone = {phone: {key[0] for key in keys}
                        for phone, keys in self.phone_measured.items()}
        rows = []
        for phone, names in sorted(by_phone.items()):
            for left, right in itertools.combinations(sorted(names), 2):
                records = self.profile_records.get((left, phone), []) + self.profile_records.get((right, phone), [])
                row = self.review_pair((left, phone), (right, phone), records)
                if row:
                    rows.append(row)
        questions = sorted(self.name_questions, key=lambda row: row["phone"])
        return questions + sorted(rows, key=lambda row: (-row["name_similarity"], row["phone"], row["names"]))


def load_identity(path, canonical_key):
    decisions = json.loads(Path(path).read_text()) if path else []
    return CustomerIdentity(decisions, canonical_key)


def save_review(path, identity, identities):
    """Preserve reviewed decisions and refresh pending questions atomically."""
    reviewed = [row for row in identity.decisions
                if row["decision"] not in {"pending", "name_pending"} and not is_automatic_decision(row)]
    save_decisions(path, reviewed + identity.review(identities))


def save_decisions(path, rows):
    """Replace a decisions file atomically, without truncating the old file."""
    destination = Path(path)
    # A failed write must never truncate previous decisions.
    fd, temporary = tempfile.mkstemp(prefix=destination.name + ".", dir=destination.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
