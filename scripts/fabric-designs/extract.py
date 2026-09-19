#!/usr/bin/env python3
"""Extract the thob design catalog from Desion.pdf.

Reads `Desion.pdf` from the repository root (it is intentionally NOT committed
— regenerate any time by running this against the PDF) and writes:

  source/<section>/<NN>-<slug>.png   the raster illustration per option
  catalog.json                       section -> ordered options, with label,
                                     slug and source file
  review.html                        a self-contained contact sheet of every
                                     option (raster thumbnails + labels) for a
                                     human to confirm the pairing before the
                                     traced assets ship

Sections and the orders column they map to:
  Neck (collar), Sleeve (sleeve), Front Pocket (f_pocket), Patti (patti),
  Thob Type (thobe_type)

The PDF is a grid of (image | name) rows: illustrations are stacked in a left
column x∈[51,273] and the label sits to its right, vertically centred on the
cell. Section headers ("Neck", "Sleeve", ...) are words above the Image/Name
column header (y < 100). Both facts are what the pairing below relies on.

Run from the repository root:
  python3 scripts/fabric-designs/extract.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "Desion.pdf"
OUT = Path(__file__).resolve().parent / "source"
CATALOG = Path(__file__).resolve().parent / "catalog.json"
REVIEW = Path(__file__).resolve().parent / "review.html"

# A section header word (above the Image/Name column header, y ~ 69) and the
# orders.column slug it produces. Also the human label used in the review.
SECTION_HEADERS = {
    ("Neck",): "neck",
    ("Sleeve",): "sleeve",
    ("Front", "Pocket"): "front_pocket",
    ("Patti",): "patti",
    ("Thob", "Type"): "thob_type",
}

# The right column holding the option names starts just past the last image
# column edge (x ~ 273), but first words can sit as close as x ~ 289. "Image"
# and "Name" are the grid's column headers, which overlap the first cell on a
# section start page and must never become part of a label.
NAME_X0 = 274
HEADER_WORDS = {"Image", "Name"}


def slugify(label: str) -> str:
    slug = label.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "unnamed"


def main() -> int:
    if not PDF.exists():
        print(f"Desion.pdf not found at {PDF}; cannot regenerate the catalog.", file=sys.stderr)
        return 1

    doc = pymupdf.open(PDF)
    options: dict[str, list[dict]] = {s: [] for s in SECTION_HEADERS.values()}
    current: str | None = None

    # Regeneration is additive-free: drop any rasters from a previous run so
    # leftover slugs from an older extraction can't linger next to new ones.
    for stale in OUT.rglob("*.png"):
        stale.unlink()

    for pno in range(doc.page_count):
        page = doc[pno]
        words = page.get_text("words")

        # Section headers sit above the Image/Name column header (y < 100).
        header_words = tuple(
            w[4] for w in words if w[1] < 100 and w[0] < 300
        )
        found = SECTION_HEADERS.get(header_words)
        if found:
            current = found

        # One row per placed image; iterate top-to-bottom so option numbers
        # follow reading order even when the PDF reuses the same xref.
        placements = [
            (img[0], r)
            for img in page.get_images(full=True)
            for r in page.get_image_rects(img[0])
        ]
        placements.sort(key=lambda p: p[1].y0)

        for xref, rect in placements:
            if current is None:
                print(f"p{pno + 1}: image before any section header — skipping", file=sys.stderr)
                continue

            # Labels can wrap onto two lines ('Saudi Patti - No Canvas ='
            # + 'Inside Button'), so match every word whose vertical span
            # overlaps the cell rather than one whose centre lands in it.
            label_words = [
                w[4]
                for w in words
                if w[0] > NAME_X0 and w[1] < rect.y1 and w[3] > rect.y0
                and w[4] not in HEADER_WORDS
            ]
            label = " ".join(label_words)

            # Extract the raster at native resolution.
            ext = doc.extract_image(xref)
            slug = slugify(label)
            number = len(options[current]) + 1
            if not label_words:
                print(
                    f"p{pno + 1}: xref {xref} has NO label — review needed",
                    file=sys.stderr,
                )
            dest = OUT / current / f"{number:02d}-{slug}.png"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(ext["image"])

            options[current].append(
                {
                    "number": number,
                    "label": label,
                    "slug": slug,
                    "file": str(dest.relative_to(OUT)),
                }
            )

    CATALOG.write_text(json.dumps(options, indent=2, ensure_ascii=False) + "\n")
    write_review(options)
    print(f"extracted {sum(len(v) for v in options.values())} options -> {OUT}")
    for section, opts in options.items():
        print(f"  {section}: {len(opts)}")
    print(f"review sheet: {REVIEW}")
    return 0


def write_review(options: dict[str, list[dict]]) -> None:
    import base64
    from html import escape

    blocks = []
    for section, opts in options.items():
        rows = []
        for opt in opts:
            img = OUT / opt["file"]
            b64 = base64.b64encode(img.read_bytes()).decode()
            rows.append(
                f'<tr><td>{opt["number"]}</td>'
                f'<td><img src="data:image/png;base64,{b64}" alt="" /></td>'
                f'<td class="name">{escape(opt["label"])}</td>'
                f'<td>{escape(opt["slug"])}</td></tr>'
            )
        blocks.append(
            f"<h2>{section} <span>({len(opts)})</span></h2>"
            f"<table><tbody>{''.join(rows)}</tbody></table>"
        )
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Desion.pdf contact sheet</title>
<style>
  body {{ font-family: sans-serif; margin: 24px; }}
  img {{ display: block; max-width: 92px; border: 1px solid #ddd; background: #fff; }}
  td {{ vertical-align: middle; padding: 6px 10px; }}
  .name {{ font-weight: 600; white-space: nowrap; }}
  h2 span {{ color: #888; font-weight: 400; }}
  table {{ border-collapse: collapse; }}
  tr {{ border-bottom: 1px solid #eee; }}
</style></head><body><h1>Desion.pdf contact sheet</h1>{''.join(blocks)}</body></html>
"""
    REVIEW.write_text(html)


if __name__ == "__main__":
    sys.exit(main())