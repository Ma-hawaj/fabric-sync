import {
  MEASUREMENT_GROUPS,
  fieldsInGroup,
  fieldsInView,
} from '../data/measurement-fields'
import type { MeasurementField } from '../data/measurement-fields'
import { layoutCaptions } from '../components/thob-diagram'
import {
  THOB_BUTTONS,
  THOB_CENTER_BACK_SEAM,
  THOB_CHEST_POCKET,
  THOB_COLLAR,
  THOB_CUFFS,
  THOB_MOBILE_POCKET,
  THOB_OUTLINE,
  THOB_PLACKET,
  THOB_SIDE_POCKETS,
  THOB_SLEEVE_BUTTONS,
  THOB_VIEW_BOX,
} from '../data/thob-sketch'
import type { ThobView } from '../data/thob-sketch'
import type { Customer, Measurement } from '../types/customers'

const TEARDOWN_FALLBACK_MS = 60_000

const ARROW_LENGTH = 8
const ARROW_HALF_WIDTH = 3

const ACCENT = '#1d4ed8'
const INK = '#10151c'
const MUTED = '#6b7280'
const RULE = '#d8dee7'

/** Arabic row labels, matching `measurement_labels` in backend/templates/order.html. */
const MEASUREMENT_LABELS_AR: Record<string, string> = {
  lengthFl: 'الطول (أمام)',
  lengthBl: 'الطول (خلف)',
  shoulder: 'الكتف',
  chest: 'الصدر',
  chestUp: 'الصدر (علوي)',
  waist: 'الخصر',
  hips: 'الأوراك',
  sleeveLength: 'طول الكم',
  neck: 'الرقبة',
  neckWidth: 'عرض الرقبة',
  openHand: 'فتحة اليد',
  cuffWidth: 'عرض الأسوارة',
  aramHole: 'فتحة الإبط',
  foWidth: 'عرض الفو',
  frantPocketLength: 'طول الجيب الأمامي',
  farntPocketLengthByWidth: 'الجيب الأمامي بالعرض',
  sidePocket: 'الجيب الجانبي',
  mobilePocketLengthByWidth: 'جيب الجوال بالعرض',
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function arrowHead(x: number, y: number, dx: number, dy: number): string {
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const baseX = x - ux * ARROW_LENGTH
  const baseY = y - uy * ARROW_LENGTH
  const px = -uy * ARROW_HALF_WIDTH
  const py = ux * ARROW_HALF_WIDTH
  return `M ${x} ${y} L ${baseX + px} ${baseY + py} L ${baseX - px} ${baseY - py} Z`
}

function dimensionLineSvg(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  return (
    `<line class="thob-dim" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />` +
    `<path class="thob-design-arrow" d="${arrowHead(x1, y1, -dx, -dy)}" />` +
    `<path class="thob-design-arrow" d="${arrowHead(x2, y2, dx, dy)}" />`
  )
}

/** The garment silhouette for one view, muted, with its buttons. */
function garmentViewSvg(view: ThobView): string {
  let parts = '<g class="thob-base">'
  parts += `<path class="thob-outline" d="${THOB_OUTLINE}" />`
  parts += `<path class="thob-detail" d="${THOB_COLLAR}" />`
  if (view === 'back') {
    parts += `<path class="thob-detail" d="${THOB_CUFFS}" />`
    parts += `<path class="thob-seam" d="${THOB_CENTER_BACK_SEAM}" />`
    for (const button of THOB_SLEEVE_BUTTONS) {
      parts += `<circle class="thob-button" cx="${button.cx}" cy="${button.cy}" r="2.5" />`
    }
  } else {
    parts += `<path class="thob-detail" d="${THOB_PLACKET}" />`
    parts += `<path class="thob-detail" d="${THOB_CUFFS}" />`
    parts += `<path class="thob-detail" d="${THOB_SIDE_POCKETS}" />`
    parts += `<path class="thob-detail" d="${THOB_CHEST_POCKET}" />`
    parts += `<path class="thob-seam" d="${THOB_MOBILE_POCKET}" />`
    for (const button of [...THOB_BUTTONS, ...THOB_SLEEVE_BUTTONS]) {
      parts += `<circle class="thob-button" cx="${button.cx}" cy="${button.cy}" r="2.5" />`
    }
  }
  parts += '</g>'
  return parts
}

/** One measured field: its arrows/guides and its placed caption box. */
function calloutSvg(
  field: MeasurementField,
  caption: { x: number; y: number; w: number; text: string },
): string {
  const { marker } = field
  let parts = '<g class="thob-callout">'

  for (const shape of marker.shapes ?? []) {
    parts += `<path class="thob-shape" d="${shape}" />`
  }
  for (const dot of marker.dots ?? []) {
    parts += `<circle class="thob-dot" cx="${dot.cx}" cy="${dot.cy}" r="2.5" />`
  }
  for (const guide of marker.guides ?? []) {
    parts +=
      `<line class="thob-guide" x1="${guide.x1}" y1="${guide.y1}" ` +
      `x2="${guide.x2}" y2="${guide.y2}" stroke-dasharray="3 3" />`
  }
  for (const dim of marker.dims ?? []) {
    parts += dimensionLineSvg(dim.x1, dim.y1, dim.x2, dim.y2)
  }

  parts +=
    `<g class="thob-caption">` +
    `<rect x="${caption.x}" y="${caption.y}" width="${caption.w}" height="20" rx="4" />` +
    `<text x="${caption.x + caption.w / 2}" y="${caption.y + 14}" class="thob-caption-text">${escapeHtml(caption.text)}</text>` +
    `</g>`

  parts += '</g>'
  return parts
}

/**
 * One view of the diagram: the garment silhouette plus a callout for every
 * recorded measurement on that view. Captions are laid out by `layoutCaptions`
 * so printed labels never overlap — the same layout `thob-diagram.tsx` and the
 * order document share.
 */
function thobViewSvg(view: ThobView, measurement: Measurement): string {
  const fields = fieldsInView(view)
  const captions = layoutCaptions(fields, measurement)

  let callouts = ''
  for (const field of fields) {
    const caption = captions.get(field.name)
    if (!caption) continue
    callouts += calloutSvg(field, {
      x: caption.x,
      y: caption.y,
      w: caption.w,
      text: caption.text,
    })
  }

  return (
    `<svg class="thob-svg" viewBox="${THOB_VIEW_BOX}" role="img" ` +
    `aria-label="${view === 'back' ? 'Back' : 'Front'} view measurement chart">` +
    garmentViewSvg(view) +
    callouts +
    `</svg>`
  )
}

/** Value as it appears in the measurement grid — unit-less, decimals kept. */
function gridValue(field: MeasurementField, value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (field.input.kind === 'number') {
    return String(Number(value))
  }
  return String(value).trim()
}

/** Bilingual group headings, matching `backend/templates/order.html`. */
const GROUP_TITLES: Record<string, string> = {
  body: 'مقاسات الجسم · Body dimensions',
  pockets: 'الجيوب · Pockets',
  style: 'التفاصيل والإكسسوارات · Style & finishing',
}

function groupCard(
  title: string,
  fields: MeasurementField[],
  measurement: Measurement,
): string {
  const rows = fields
    .map((field) => {
      const value = (measurement as unknown as Record<string, unknown>)[
        field.name
      ]
      if (value === undefined || value === null || value === '') return null
      const label = MEASUREMENT_LABELS_AR[field.name] ?? field.label
      return (
        `<div class="m"><span>${escapeHtml(label)}</span>` +
        `<span class="num">${escapeHtml(gridValue(field, value))}</span></div>`
      )
    })
    .filter(Boolean)
  return (
    `<div class="measurement-group"><h3>${escapeHtml(title)}</h3>` +
    `<div class="measurement-grid">${rows.join('')}</div></div>`
  )
}

function measurementsGrid(measurement: Measurement): string {
  const groups = MEASUREMENT_GROUPS.map((group) =>
    groupCard(
      GROUP_TITLES[group.id] ?? group.title,
      fieldsInGroup(group.id),
      measurement,
    ),
  ).join('')

  const date = formatMeasurementDate(measurement.date)
  return (
    groups +
    `<div class="measurement-group"><h3>المقايسة · Recorded</h3>` +
    `<div class="measurement-grid">` +
    `<div class="m"><span>تاريخ المقايسة<span class="en">Measured on</span></span>` +
    `<span class="num" dir="ltr">${escapeHtml(date)}</span></div>` +
    `</div></div>`
  )
}

function formatMeasurementDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function generateMeasurementsHtml(
  customer: Customer,
  measurement: Measurement,
): string {
  const primaryName = customer.nameArabic ? customer.nameArabic : customer.name
  const englishName = customer.nameArabic ? customer.name : null

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>Measurements - ${escapeHtml(customer.name)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --ink: ${INK};
    --muted: ${MUTED};
    --rule: ${RULE};
    --tint: #f4f6f9;
    --accent: ${ACCENT};
  }
  body {
    margin: 0;
    padding: 12mm;
    font-family: 'Noto Sans Arabic', 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    color: var(--ink);
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print { body { padding: 0; } }
  .en {
    display: block;
    font-size: 0.82em;
    color: var(--muted);
    font-weight: 400;
    direction: ltr;
    text-align: right;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--ink);
  }
  .company-name {
    margin: 0;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.25;
  }
  .company-name .en { font-size: 13px; color: var(--ink); }
  .company-meta { margin-top: 5px; color: var(--muted); font-size: 10px; }
  .company-meta div + div { margin-top: 1px; }
  .doc-title { text-align: left; flex-shrink: 0; }
  .doc-title h2 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 0.02em; }
  .doc-title h2 .en { text-align: left; font-size: 11px; }
  .doc-number {
    margin-top: 6px;
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 14px;
    font-weight: 700;
    color: var(--accent);
    direction: ltr;
  }
  h2.section-title {
    margin: 16px 0 6px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .thob-sheet {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 10px;
  }
  .thob-panel {
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--tint);
  }
  .thob-panel h3 {
    margin: 0 0 2px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .thob-svg { display: block; width: 100%; height: auto; }
  .thob-outline {
    fill: #fff;
    stroke: var(--ink);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .thob-detail {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .thob-seam {
    fill: none;
    stroke: var(--muted);
    stroke-width: 0.8;
    stroke-dasharray: 4 3;
    stroke-linejoin: round;
  }
  .thob-button { fill: var(--ink); }
  .thob-guide {
    fill: none;
    stroke: var(--accent);
    stroke-width: 0.8;
    stroke-linecap: round;
  }
  .thob-dim { fill: none; stroke: var(--accent); stroke-width: 1.1; }
  .thob-design-arrow { fill: var(--accent); }
  .thob-shape {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.1;
    stroke-linejoin: round;
  }
  .thob-dot { fill: var(--accent); }
  .thob-caption rect { fill: #fff; stroke: var(--rule); }
  .thob-caption text { font-family: inherit; text-anchor: middle; }
  .thob-caption-text { font-size: 8.5px; font-weight: 600; fill: var(--ink); }
  .measurements {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 10px;
  }
  .measurement-group {
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--tint);
  }
  .measurement-group h3 {
    margin: 0 0 5px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .measurement-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
  }
  .measurement-group .m {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px dotted var(--rule);
    padding-bottom: 2px;
  }
  .measurement-group .m span:first-child { color: var(--muted); font-size: 9.5px; }
  .measurement-group .m span:last-child { font-weight: 600; }
  .num {
    text-align: left;
    direction: ltr;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  footer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--rule);
    text-align: center;
    color: var(--muted);
    font-size: 9.5px;
  }
</style>
</head>
<body>
  <header>
    <div>
      <h1 class="company-name">
        ${escapeHtml(primaryName)}${englishName ? `<span class="en">${escapeHtml(englishName)}</span>` : ''}
      </h1>
      <div class="company-meta">
        <div dir="ltr">${escapeHtml(customer.mobileNo)}</div>
      </div>
    </div>
    <div class="doc-title">
      <h2>
        مقاسات العميل
        <span class="en">Customer Measurements</span>
      </h2>
      <div class="doc-number">${escapeHtml(formatMeasurementDate(measurement.date))}</div>
    </div>
  </header>

  <h2 class="section-title">المقاسات المسجلة · Measurements</h2>
  <div class="thob-sheet">
    <div class="thob-panel">
      <h3>واجهة الثوب · Front of Thob</h3>
      ${thobViewSvg('front', measurement)}
    </div>
    <div class="thob-panel">
      <h3>خلف الثوب · Back of Thob</h3>
      ${thobViewSvg('back', measurement)}
    </div>
  </div>

  <div class="measurements">
    ${measurementsGrid(measurement)}
  </div>

  <footer>
    شكراً لتعاملكم معنا · Thank you for your business
    <div dir="ltr">${escapeHtml(formatMeasurementDate(measurement.date))}</div>
  </footer>
</body>
</html>`
}

export async function printMeasurements(
  customer: Customer,
  measurement: Measurement | undefined,
): Promise<void> {
  if (!measurement) return
  const html = generateMeasurementsHtml(customer, measurement)

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.style.visibility = 'hidden'

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true })
  })

  frame.srcdoc = html
  document.body.appendChild(frame)

  await loaded

  const view = frame.contentWindow
  if (!view) {
    frame.remove()
    throw new Error('Could not open the measurements document for printing.')
  }

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    frame.remove()
  }

  view.addEventListener('afterprint', remove, { once: true })
  window.setTimeout(remove, TEARDOWN_FALLBACK_MS)

  view.focus()
  view.print()
}
