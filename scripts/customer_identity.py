"""Explicit, phone-scoped customer identity decisions for legacy ingestion."""
import itertools
import json
import os
import tempfile
from difflib import SequenceMatcher
from pathlib import Path


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
    rows = reviewed + identity.review(identities)
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
