#!/usr/bin/env python3
"""Review saved customer identities interactively, without Excel or a database."""
import argparse
import json
from pathlib import Path

from customer_identity import (CustomerIdentity, canon_key, is_automatic_decision,
                               norm_name, norm_phone, save_decisions)

DEFAULT_DECISIONS = Path(__file__).resolve().parent / "customer-decisions.json"


def review_pairs(identity):
    """Refresh file pairs and number-gap evidence after resolving aliases."""
    pairs = {}
    for row in identity.decisions:
        if row["decision"] != "pending" and not is_automatic_decision(row):
            continue
        left, right = (identity.key(name, row["phone"]) for name in row["names"])
        if left == right or frozenset((left, right)) in identity.separate:
            continue
        names = sorted((left[0], right[0]))
        key = (left[1], *names)
        records = pairs.get(key, {}).get("measurements", []) + row.get("measurements", [])
        records = list({json.dumps(r, sort_keys=True): r for r in records}.values())
        pairs[key] = identity.review_pair(left, right, records)
    return sorted(pairs.values(), key=lambda row: (-row["name_similarity"], row["phone"], row["names"]))


def pending_pairs(identity):
    return [row for row in review_pairs(identity) if row["decision"] == "pending"]


def pair_key(row):
    return (row["phone"], *row["names"])


def pending_names(identity):
    rows = []
    for row in identity.decisions:
        if row["decision"] != "name_pending" or norm_phone(row["phone"]) in identity.preferred_names:
            continue
        measured = {identity.base_key(name, row["phone"]) for name in row.get("measurement_names", [])}
        if len(measured) != 1:
            rows.append(row)
    return rows


def record_decisions(identity, rows):
    reviewed = [row for row in identity.decisions
                if row["decision"] not in {"pending", "name_pending"} and not is_automatic_decision(row)]
    pending = [row for row in identity.decisions
               if row["decision"] in {"pending", "name_pending"} or is_automatic_decision(row)]
    updated = CustomerIdentity(reviewed + rows + pending, canon_key)
    return CustomerIdentity(reviewed + rows + pending_names(updated) + review_pairs(updated), canon_key)


def record_name(identity, row, name):
    chosen = norm_name(name)
    if not chosen:
        raise ValueError("Choose a non-empty customer name")
    rows = [r for r in identity.decisions
            if not (r["decision"] in {"name", "name_pending"} and norm_phone(r["phone"]) == norm_phone(row["phone"]))]
    return CustomerIdentity(rows + [{**row, "decision": "name", "name": chosen}], canon_key)


def show_measurements(row, identity, output_fn, full=False):
    grouped = {}
    for record in row.get("measurements", []):
        key = identity.base_key(record["name"], record.get("phone", row["phone"]))
        grouped.setdefault(key, []).append(record)
    for records in grouped.values():
        output_fn(f"Measurements for {records[0]['name']}:")
        records = sorted(records, key=lambda r: (r.get("date", ""), r.get("measurementNo", 0)), reverse=True)
        for record in records if full else records[:2]:
            number = record.get("measurementNo")
            label = f"Measurement No {number}" if number is not None else "Saved measurement"
            output_fn(f"  {label} · {record.get('date') or 'date unavailable'}")
            values = record.get("values", {})
            fields = list(values) if full else [k for k in ("chest", "front_height", "shoulder", "waist", "hip", "neck_size") if k in values]
            if not fields:
                fields = list(values)[:6]
            output_fn("  " + (" · ".join(f"{key.replace('_', ' ')}: {values[key]}" for key in fields) or "No values recorded."))
        if not full and len(records) > 2:
            output_fn(f"  {len(records) - 2} older snapshots; use v to see all details.")


def review(path, *, phone=None, min_similarity=0, input_fn=input, output_fn=print):
    path = Path(path)
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

    output_fn(f"Decisions: {path.resolve()}")
    output_fn("Each answer is saved immediately. Unmeasured contacts need one name; shared measured profiles need identity verification.")
    refreshed = record_decisions(identity, [])
    automatic_count = sum(is_automatic_decision(row) for row in refreshed.decisions)
    if automatic_count or any(is_automatic_decision(row) for row in identity.decisions):
        if refreshed.decisions != identity.decisions:
            save(refreshed)
            identity = refreshed
        output_fn(f"Automatically separated pairs: {automatic_count} (Measurement Nos are 1–5 apart).")
    try:
        while True:
            pairs = pending_pairs(identity)
            names = pending_names(identity)
            name_candidates = [r for r in names if (phone is None or norm_phone(r["phone"]) == phone)
                               and ("name", norm_phone(r["phone"])) not in skipped]
            candidates = [r for r in pairs if (phone is None or r["phone"] == phone)
                          and r["name_similarity"] >= min_similarity and pair_key(r) not in skipped]
            first_name = next((r for r in name_candidates if not r.get("measurement_names")), None)
            if first_name is None and not candidates and name_candidates:
                first_name = name_candidates[0]
            if first_name is not None:
                row = first_name
                name_mode = True
                current_key = ("name", norm_phone(row["phone"]))
                output_fn(f"\nPhone: {row['phone']} — choose one name for the contacts without measurements.")
                for index, name in enumerate(row["names"], 1):
                    suffix = " (has measurements)" if name in row.get("measurement_names", []) else ""
                    output_fn(f"  {index}. {name}{suffix}")
                answer = input_fn("Name number, [n] custom name, [k] skip, [u] undo, [q] quit: ").strip().casefold()
            elif candidates:
                row = candidates[0]
                name_mode = False
                current_key = pair_key(row)
                output_fn(f"\n{len(pairs)} identity comparisons | Phone: {row['phone']} | Similarity: {row['name_similarity']:.0%}")
                output_fn(f"  1. {row['names'][0]}\n  2. {row['names'][1]}")
                show_measurements(row, identity, output_fn)
                answer = input_fn("[s] same person  [d] different people  [k] skip  [v] measurement details  [a] remaining phone pairs different  [u] undo  [q] quit: ").strip().casefold()
            else:
                output_fn(f"\nNo more questions in this review. {len(names)} names and {len(pairs)} identity comparisons remain overall.")
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
                skipped.add(current_key)
                continue
            if name_mode:
                if answer.isdecimal() and 1 <= int(answer) <= len(row["names"]):
                    chosen = row["names"][int(answer) - 1]
                elif answer in {"n", "name"}:
                    chosen = input_fn("Preferred customer name: ")
                else:
                    output_fn("Choose a listed name number, n, k, u, or q.")
                    continue
                try:
                    updated = record_name(identity, row, chosen)
                except ValueError as exc:
                    output_fn(str(exc))
                    continue
                count = 1
            else:
                if answer in {"v", "view"}:
                    show_measurements(row, identity, output_fn, full=True)
                    continue
                if answer in {"a", "all"}:
                    group = [pair for pair in pairs if pair["phone"] == row["phone"]]
                    output_fn("Measured names on this phone:")
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
                    output_fn("Choose s, d, k, v, a, u, or q.")
                    continue
                try:
                    updated = record_decisions(identity, decisions)
                except ValueError as exc:
                    output_fn(f"Decision conflicts with saved answers: {exc}")
                    continue
                count = len(decisions)
            save(updated)
            history.append(identity)
            history = history[-20:]
            identity = updated
            output_fn(f"Saved {count} decision(s).")
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
