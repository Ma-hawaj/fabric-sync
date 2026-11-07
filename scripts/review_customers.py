#!/usr/bin/env python3
"""Review saved customer identities interactively, without Excel or a database."""
import argparse
import json
from difflib import SequenceMatcher
from pathlib import Path

from customer_identity import CustomerIdentity, canon_key, norm_phone, save_decisions

DEFAULT_DECISIONS = Path(__file__).resolve().parent / "customer-decisions.json"


def pending_pairs(identity):
    """Keep only unresolved file entries, collapsing decisions implied by aliases."""
    pairs = {}
    for row in identity.decisions:
        if row["decision"] != "pending":
            continue
        left, right = (identity.key(name, row["phone"]) for name in row["names"])
        if left == right or frozenset((left, right)) in identity.separate:
            continue
        names = sorted((left[0], right[0]))
        key = (left[1], *names)
        pairs[key] = {"phone": left[1], "names": names, "decision": "pending",
                      "name_similarity": round(SequenceMatcher(None, *names).ratio(), 3)}
    return sorted(pairs.values(), key=lambda row: (-row["name_similarity"], row["phone"], row["names"]))


def pair_key(row):
    return (row["phone"], *row["names"])


def record_decisions(identity, rows):
    reviewed = [row for row in identity.decisions if row["decision"] != "pending"]
    pending = [row for row in identity.decisions if row["decision"] == "pending"]
    updated = CustomerIdentity(reviewed + rows + pending, canon_key)
    return CustomerIdentity(reviewed + rows + pending_pairs(updated), canon_key)


def review(path, *, phone=None, min_similarity=0, input_fn=input, output_fn=print):
    path = Path(path)
    # Read one snapshot, and refuse to overwrite another editor's changes.
    expected = path.read_bytes()
    identity = CustomerIdentity(json.loads(expected), canon_key)
    skipped = set()
    history = []

    def save(updated):
        nonlocal expected
        if path.read_bytes() != expected:
            raise ValueError("The decisions file changed outside this session. Restart to load it; no changes were overwritten.")
        save_decisions(path, updated.decisions)
        expected = path.read_bytes()

    def selected(rows):
        return [row for row in rows if (phone is None or row["phone"] == phone)
                and row["name_similarity"] >= min_similarity]

    output_fn(f"Decisions: {path.resolve()}")
    output_fn("Each answer is saved immediately. Similarity only sorts suggestions; it never merges people.")
    try:
        while True:
            remaining = pending_pairs(identity)
            candidates = [row for row in selected(remaining) if pair_key(row) not in skipped]
            if candidates:
                row = candidates[0]
                output_fn(f"\n{len(remaining)} unresolved pairs | Phone: {row['phone']} | Similarity: {row['name_similarity']:.0%}")
                output_fn(f"  1. {row['names'][0]}\n  2. {row['names'][1]}")
                answer = input_fn("[s] same person  [d] different people  [k] skip  [a] remaining phone pairs different  [u] undo  [q] quit: ").strip().casefold()
            else:
                output_fn(f"\nNo more pairs in this review. {len(remaining)} unresolved pairs remain overall.")
                if not history:
                    break
                answer = input_fn("[u] undo last answer  [q] quit: ").strip().casefold()
                if answer not in {"u", "undo", "q", "quit"}:
                    output_fn("Choose u or q.")
                    continue
            if answer in {"q", "quit"}:
                break
            if answer in {"u", "undo"}:
                if not history:
                    output_fn("No answers to undo in this session.")
                    continue
                updated = history[-1]
                save(updated)
                history.pop()
                identity = updated
                skipped.clear()
                output_fn("Last answer undone and saved.")
                continue
            if answer in {"k", "skip", ""}:
                skipped.add(pair_key(row))
                continue
            if answer in {"a", "all"}:
                group = [pair for pair in remaining if pair["phone"] == row["phone"]]
                output_fn("Unresolved names on this phone:")
                for name in sorted({name for pair in group for name in pair["names"]}):
                    output_fn(f"  - {name}")
                confirmed = input_fn(f"Mark all {len(group)} remaining pairs for this phone as different people? [y/N]: ").strip().casefold()
                if confirmed not in {"y", "yes"}:
                    output_fn("Cancelled; nothing changed.")
                    continue
                decisions = [{**pair, "decision": "different"} for pair in group]
            elif answer in {"s", "same", "d", "different"}:
                decision = "same" if answer in {"s", "same"} else "different"
                decisions = [{**row, "decision": decision}]
            else:
                output_fn("Choose s, d, k, a, u, or q.")
                continue
            try:
                updated = record_decisions(identity, decisions)
            except ValueError as exc:
                output_fn(f"Decision conflicts with saved answers: {exc}")
                continue
            save(updated)
            history.append(identity)
            history = history[-20:]
            identity = updated
            output_fn(f"Saved {len(decisions)} decision(s).")
    except (EOFError, KeyboardInterrupt):
        output_fn("\nReview stopped.")
    output_fn(f"Answers saved in {path.resolve()}. Copy this file to production after reviewing.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-decisions", type=Path, default=DEFAULT_DECISIONS,
                        help="saved decisions JSON (default: scripts/customer-decisions.json)")
    parser.add_argument("--phone", help="review only this phone number")
    parser.add_argument("--min-similarity", type=float, default=0,
                        help="review only name similarities at or above 0–1 (for example 0.8)")
    args = parser.parse_args(argv)
    if not 0 <= args.min_similarity <= 1:
        parser.error("--min-similarity must be between 0 and 1")
    phone = norm_phone(args.phone) if args.phone is not None else None
    if args.phone is not None and phone is None:
        parser.error("--phone needs a phone number")
    try:
        return review(args.customer_decisions, phone=phone, min_similarity=args.min_similarity)
    except FileNotFoundError:
        parser.error("Decisions file missing. Run scripts/ingest_xlsm.py --dry-run first, or pass --customer-decisions PATH.")
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
