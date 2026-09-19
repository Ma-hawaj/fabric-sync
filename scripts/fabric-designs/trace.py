#!/usr/bin/env python3
"""Trace the extracted rasters into themeable SVG design assets.

Reads `catalog.json` (from extract.py) plus the rasters in `source/` and writes
one SVG per option to the frontend's `public/designs/<section>/<slug>.svg`.

The SVGs are written to be theme-friendly: a viewBox with no intrinsic size
(they scale to whatever the CSS gives them) and `fill="currentColor"` on the
root, so the app's dark mode can recolor them and the printed invoice renders
them in ink by simply setting `color`. White areas are not drawn at all.

Also writes `review-trace.html`, a side-by-side raster/SVG comparison sheet.

Run from the repository root:
  python3 scripts/fabric-designs/trace.py
"""

from __future__ import annotations

import base64
import json
import re
import sys
from html import escape
from pathlib import Path

import vtracer

HERE = Path(__file__).resolve().parent
CATALOG = HERE / "catalog.json"
SOURCE = HERE / "source"
DESIGNS = HERE.parents[1] / "frontend" / "public" / "designs"
REVIEW_TRACE = HERE / "review-trace.html"

TRACE_KWARGS = dict(
    colormode="binary",
    filter_speckle=6,
    color_precision=6,
    layer_difference=24,
    corner_threshold=60,
    length_threshold=3.0,
    max_iterations=10,
    splice_threshold=45,
    path_precision=2,
)


def trace_svg(path: Path) -> str:
    temp = path.with_suffix(".tmp.svg")
    vtracer.convert_image_to_svg_py(str(path), str(temp), **TRACE_KWARGS)
    text = temp.read_text()
    temp.unlink()

    # Drop the xml declaration, the generator comment and the tracer's own
    # <svg ...> wrapper; all that remains is pure <path> content.
    text = re.sub(r"<\?xml.*?\?>", "", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    m = re.search(
        r'<svg[^>]*width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"', text
    )
    width, height = (m.group(1), m.group(2)) if m else ("1", "1")
    text = re.sub(r"<svg[^>]*>", "", text, count=1)
    text = text.rsplit("</svg>", 1)[0]
    # Recolor traced shapes with currentColor instead of an absolute black so
    # the app's dark mode and the printed invoice control the ink color.
    text = re.sub(r'fill="#[0-9a-fA-F]{3,8}"', 'fill="currentColor"', text)

    return (
        f'<svg viewBox="0 0 {width} {height}" fill="currentColor" '
        f'aria-hidden="true">{text.strip()}</svg>'
    )


def main() -> int:
    if not CATALOG.exists():
        print("catalog.json missing — run extract.py first.", file=sys.stderr)
        return 1

    catalog = json.loads(CATALOG.read_text())
    sheets = []
    total = 0
    for section, options in catalog.items():
        rows = []
        for opt in options:
            src = SOURCE / opt["file"]
            dest = DESIGNS / section / f"{opt['slug']}.svg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            svg = trace_svg(src)
            dest.write_text(svg + "\n")
            total += 1
            src_b64 = base64.b64encode(src.read_bytes()).decode()
            rows.append(
                f'<tr><td>{opt["number"]}</td><td class="name">{escape(opt["label"])}</td>'
                f'<td><img src="data:image/png;base64,{src_b64}" alt="" /></td>'
                f"<td>{svg}</td></tr>"
            )
        sheets.append(
            f"<h2>{section} <span>({len(options)})</span></h2>"
            f"<table><tbody>{''.join(rows)}</tbody></table>"
        )

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Trace comparison</title>
<style>
  body {{ font-family: sans-serif; margin: 24px; }}
  img, svg {{ display: block; width: 160px; height: auto; border: 1px solid #ccc; background: #fff; }}
  svg {{ height: 90px; }}
  td {{ vertical-align: middle; padding: 6px 10px; }}
  .name {{ font-weight: 600; white-space: nowrap; }}
  h2 span {{ color: #888; font-weight: 400; }}
  table {{ border-collapse: collapse; width: 100%; }}
  tr {{ border-bottom: 1px solid #eee; }}
</style></head><body><h1>Raster vs traced SVG</h1>{''.join(sheets)}</body></html>
"""
    REVIEW_TRACE.write_text(html)
    print(f"traced {total} SVGs -> {DESIGNS}")
    print(f"comparison sheet: {REVIEW_TRACE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())