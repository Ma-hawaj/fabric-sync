import { MEASUREMENT_GROUPS, fieldsInGroup } from '../data/measurement-fields'
import type { MeasurementField } from '../data/measurement-fields'
import {
  THOBE_ARROW_FILL,
  THOBE_BACK_ARROWS,
  THOBE_BACK_DIMS,
  THOBE_BACK_ELLIPSES,
  THOBE_BACK_PATHS,
  THOBE_FRONT_ARROWS,
  THOBE_FRONT_DIMS,
  THOBE_FRONT_ELLIPSES,
  THOBE_FRONT_PATHS,
  THOBE_VALUE_SLOTS,
  THOBE_VIEWBOX,
} from '../components/thob-diagram'
import type { Customer, Measurement } from '../types/customers'

const TEARDOWN_FALLBACK_MS = 60_000

const ACCENT = '#1d4ed8'
const INK = '#10151c'
const MUTED = '#6b7280'
const RULE = '#d8dee7'

/** Arabic row labels, matching `measurement_labels` in backend/templates/order.html. */
const MEASUREMENT_LABELS_AR: Record<string, string> = {
  frontHeight: 'الطول (أمام)',
  backHeight: 'الطول (خلف)',
  shoulder: 'الكتف',
  shoulderDown: 'نزلة الكتف',
  chest: 'الصدر',
  chestUp: 'الصدر (علوي)',
  waist: 'الخصر',
  hip: 'الأوراك',
  bottom: 'الأسفل',
  bottomFold: 'ثنية الأسفل',
  fullBody: 'الجسم الكامل',
  sleeveHalf: 'نصف الكم',
  openFold: 'الثنية المفتوحة',
  sleeveLength: 'طول الكم',
  neckSize: 'الرقبة',
  neckWidth: 'عرض الرقبة',
  openHand: 'فتحة اليد',
  openHandFolding: 'ثنية فتحة اليد',
  cuffWidth: 'عرض الأسوارة',
  cuffSize: 'الكفلنج',
  armhole: 'فتحة الإبط',
  foWidth: 'عرض الفو',
  fo: 'الفو',
  frontPocketLength: 'طول الجيب الأمامي',
  frontPocketLengthByWidth: 'الجيب الأمامي بالعرض',
  sidePocket: 'طول الجيب الجانبي',
  sidePocketLengthByWidth: 'الجيب الجانبي بالعرض',
  mobilePocketLengthByWidth: 'جيب الجوال بالعرض',
  type: 'النوع',
  fit: 'القصّة',
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ellipseSvg(e: {
  cx: number
  cy: number
  rx: number
  ry: number
  rotate?: { angle: number; cx: number; cy: number }
  strokeWidth?: number
}): string {
  const transform = e.rotate
    ? ` transform="rotate(${e.rotate.angle} ${e.rotate.cx} ${e.rotate.cy})"`
    : ''
  const width = e.strokeWidth ? ` stroke-width="${e.strokeWidth}"` : ''
  return `<ellipse class="thob-garment" cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}"${transform}${width} />`
}

/**
 * The thobe sheet: front + back silhouettes in one SVG with every recorded
 * value at its slot. Fields the snapshot didn't capture are skipped —
 * matching the on-screen `ThobDiagram`, which renders nothing for them.
 */
function thobeSheetSvg(measurement: Measurement): string {
  const values = measurement as unknown as Record<string, unknown>

  let svg =
    `<svg class="thob-svg" viewBox="${THOBE_VIEWBOX}" role="img" ` +
    `aria-label="Thobe measurement sheet">`

  svg += '<g class="thob-garment-group">'
  for (const e of THOBE_FRONT_ELLIPSES) svg += ellipseSvg(e)
  for (const p of THOBE_FRONT_PATHS) {
    const extra = p.grey ? ' stroke="#999" stroke-width="0.8"' : ''
    svg += `<path class="thob-garment" d="${p.d}"${extra} />`
  }
  for (const e of THOBE_BACK_ELLIPSES) svg += ellipseSvg(e)
  for (const p of THOBE_BACK_PATHS) {
    const extra = p.dashed ? ' stroke-dasharray="6 3" stroke-width="1"' : ''
    svg += `<path class="thob-garment" d="${p.d}"${extra} />`
  }
  svg += '</g>'

  svg += '<g class="thob-dim-group">'
  for (const d of [...THOBE_FRONT_DIMS, ...THOBE_BACK_DIMS]) {
    svg += `<path class="thob-dim" d="${d}" />`
  }
  for (const d of [...THOBE_FRONT_ARROWS, ...THOBE_BACK_ARROWS]) {
    svg += `<path class="thob-arrow" d="${d}" fill="${THOBE_ARROW_FILL}" />`
  }
  svg += '</g>'

  svg += '<g font-family="Arial, sans-serif">'
  for (const slot of THOBE_VALUE_SLOTS) {
    const value = values[slot.key]
    if (value === undefined || value === null || value === '') continue
    const text = escapeHtml(String(value))
    svg +=
      `<g><title>${escapeHtml(slot.label)}</title>` +
      `<text x="${slot.x}" y="${slot.y}" font-size="${slot.size}" text-anchor="middle" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round">${text}</text>` +
      `<text x="${slot.x}" y="${slot.y}" font-size="${slot.size}" text-anchor="middle" class="thob-value">${text}</text></g>`
  }
  svg += '</g>'

  svg += '</svg>'
  return svg
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
  // An empty group (e.g. no pocket values recorded) prints nothing — the
  // grid only carries what the snapshot actually captured.
  if (rows.length === 0) return ''
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
  // Record-level choices ride the Recorded card rather than any diagram
  // group — they describe the record, and legacy snapshots may not have
  // them, so each row only prints when captured.
  const metaRows = [
    measurement.type
      ? `<div class="m"><span>النوع<span class="en">Type</span></span>` +
        `<span class="num">${escapeHtml(measurement.type)}</span></div>`
      : '',
    measurement.fit
      ? `<div class="m"><span>القصّة<span class="en">Fit</span></span>` +
        `<span class="num">${escapeHtml(measurement.fit)}</span></div>`
      : '',
  ].join('')
  return (
    groups +
    `<div class="measurement-group"><h3>المقايسة · Recorded</h3>` +
    `<div class="measurement-grid">` +
    metaRows +
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
  .thob-svg { display: block; width: 100%; max-width: 560px; height: auto; margin: 0 auto; }
  .thob-garment {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .thob-dim { fill: none; stroke: var(--ink); stroke-width: 1; }
  .thob-arrow { fill: var(--ink); }
  .thob-value { font-size: inherit; font-weight: 600; fill: #000; }
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

  <h2 class="section-title">ورقة الثوب · Thobe Sheet</h2>
  <div class="thob-sheet">
    <div class="thob-panel">
      <h3>الثوب · Thobe</h3>
      ${thobeSheetSvg(measurement)}
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
