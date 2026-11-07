"""Explicit, phone-scoped customer identity decisions for legacy ingestion."""
import itertools
import json
import os
import re
import tempfile
from difflib import SequenceMatcher
from pathlib import Path


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
        if not isinstance(decisions, list):
            raise ValueError("Customer decisions must be a JSON list")
        self.decisions = decisions
        pairs = []
        for row in decisions:
            if not isinstance(row, dict) or row.get("decision") not in {"same", "different", "pending"}:
                raise ValueError("Each decision must be same, different, or pending")
            names = row.get("names")
            if not isinstance(names, list) or len(names) != 2 or not all(isinstance(n, str) for n in names):
                raise ValueError("Each decision needs exactly two names")
            keys = [canonical_key(n, row.get("phone")) for n in names]
            if not all(keys) or keys[0] == keys[1]:
                raise ValueError("Decisions need two distinct names and a phone")
            pairs.append((row["decision"], *keys))
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

    def key(self, name, phone):
        return self.resolve(self.canonical_key(name, phone))

    def review(self, identities):
        by_phone = {}
        for name, phone in identities:
            key = self.key(name, phone)
            if key:
                by_phone.setdefault(key[1], set()).add(key[0])
        rows = []
        for phone, names in sorted(by_phone.items()):
            for left, right in itertools.combinations(sorted(names), 2):
                if frozenset(((left, phone), (right, phone))) in self.separate:
                    continue
                rows.append({"phone": phone, "names": [left, right],
                             "decision": "pending",
                             "name_similarity": round(SequenceMatcher(None, left, right).ratio(), 3)})
        return sorted(rows, key=lambda row: (-row["name_similarity"], row["phone"], row["names"]))


def load_identity(path, canonical_key):
    decisions = json.loads(Path(path).read_text()) if path else []
    return CustomerIdentity(decisions, canonical_key)


def save_review(path, identity, identities):
    """Preserve reviewed decisions and refresh pending pairs atomically."""
    reviewed = [row for row in identity.decisions if row["decision"] != "pending"]
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
