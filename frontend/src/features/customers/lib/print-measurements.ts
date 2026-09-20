import {
  MEASUREMENT_FIELDS,
  MEASUREMENT_UNIT,
  MEASUREMENT_GROUPS,
  fieldsInGroup,
} from '../data/measurement-fields'
import type { MeasurementField } from '../data/measurement-fields'
import {
  THOB_BUTTONS,
  THOB_CHEST_POCKET,
  THOB_COLLAR,
  THOB_CUFFS,
  THOB_MOBILE_POCKET,
  THOB_OUTLINE,
  THOB_PLACKET,
  THOB_SIDE_POCKETS,
  THOB_SLEEVE_BUTTONS,
  THOB_VIEW_BOX,
  THOB_WIDTH,
} from '../data/thob-sketch'
import type { Customer, Measurement } from '../types/customers'

const TEARDOWN_FALLBACK_MS = 60_000

function calloutLabel(
  field: MeasurementField,
  value: string | number | null | undefined,
): string {
  if (value === undefined || value === null || value === '') return field.label
  const suffix = field.input.kind === 'number' ? ` ${MEASUREMENT_UNIT}` : ''
  return `${field.label} \u00b7 ${value}${suffix}`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ARROW_LENGTH = 8
const ARROW_HALF_WIDTH = 3

/**
 * Print-only label overrides. The interactive diagram uses per-field
 * hover states so labels never collide, but the print layout renders
 * every numeric callout at once. These shift the few labels that would
 * overlap into clear space.
 */
const PRINT_LABEL_OVERRONS: Record<string, { x: number; y: number }> = {
  shoulder: { x: 195, y: 14 },
  neckWidth: { x: 285, y: 14 },
  aramHole: { x: 128, y: 130 },
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
  color: string,
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  return (
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.25"/>` +
    `<path d="${arrowHead(x1, y1, -dx, -dy)}" fill="${color}"/>` +
    `<path d="${arrowHead(x2, y2, dx, dy)}" fill="${color}"/>`
  )
}

function calloutSvg(
  field: MeasurementField,
  value: string | number | null | undefined,
  color: string,
): string {
  const { marker } = field
  const text = calloutLabel(field, value)
  const width = Math.max(40, text.length * 7 + 18)
  const pos =
    field.name in PRINT_LABEL_OVERRONS
      ? PRINT_LABEL_OVERRONS[field.name]
      : marker.label
  const labelX = Math.min(
    Math.max(pos.x, width / 2 + 4),
    THOB_WIDTH - width / 2 - 4,
  )
  const labelY = pos.y

  let parts = '<g>'

  for (const shape of marker.shapes ?? []) {
    parts += `<path d="${shape}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`
  }

  for (const dot of marker.dots ?? []) {
    parts += `<circle cx="${dot.cx}" cy="${dot.cy}" r="3.5" fill="${color}"/>`
  }

  if (field.name === 'aramHole' && field.name in PRINT_LABEL_OVERRONS) {
    const to = PRINT_LABEL_OVERRONS.aramHole
    parts += `<line x1="190" y1="105" x2="${to.x + 40}" y2="${to.y}" stroke="${color}" stroke-width="0.75" stroke-dasharray="3 3"/>`
  } else if (marker.guides) {
    for (const guide of marker.guides) {
      parts += `<line x1="${guide.x1}" y1="${guide.y1}" x2="${guide.x2}" y2="${guide.y2}" stroke="${color}" stroke-width="0.75" stroke-dasharray="3 3"/>`
    }
  }

  for (const dim of marker.dims ?? []) {
    parts += dimensionLineSvg(dim.x1, dim.y1, dim.x2, dim.y2, color)
  }

  parts +=
    `<rect x="${labelX - width / 2}" y="${labelY - 11}" width="${width}" height="22" rx="6" fill="white" stroke="${color}" stroke-width="0.75"/>` +
    `<text x="${labelX}" y="${labelY + 4}" text-anchor="middle" fill="${color}" font-size="13" font-family="system-ui, sans-serif" font-weight="500">${escapeHtml(text)}</text>`

  parts += '</g>'
  return parts
}

function garmentSvg(color: string): string {
  let svg = `<g stroke="${color}" fill="none">`
  svg += `<path d="${THOB_OUTLINE}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="1.75" stroke-linejoin="round"/>`
  for (const d of [THOB_COLLAR, THOB_PLACKET, THOB_CUFFS, THOB_SIDE_POCKETS]) {
    svg += `<path d="${d}" stroke-width="1.25" stroke-linejoin="round"/>`
  }
  svg += `<path d="${THOB_CHEST_POCKET}" stroke-width="1.25" stroke-linejoin="round"/>`
  svg += `<path d="${THOB_MOBILE_POCKET}" stroke-width="1" stroke-dasharray="4 3" stroke-linejoin="round"/>`
  for (const btn of [...THOB_BUTTONS, ...THOB_SLEEVE_BUTTONS]) {
    svg += `<circle cx="${btn.cx}" cy="${btn.cy}" r="2.5" fill="${color}"/>`
  }
  svg += '</g>'
  return svg
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
  const color = '#4a6fa5'

  let calloutsSvg = ''
  for (const field of MEASUREMENT_FIELDS) {
    if (field.input.kind !== 'number') continue
    const value = (measurement as Record<string, unknown>)[field.name]
    calloutsSvg += calloutSvg(field, value, color)
  }

  const svgContent = garmentSvg(color) + calloutsSvg

  let measurementRows = ''
  for (const group of MEASUREMENT_GROUPS) {
    const fields = fieldsInGroup(group.id)
    const rows = fields
      .map((field) => {
        const value = (measurement as Record<string, unknown>)[field.name]
        if (value === undefined || value === null || value === '') return null
        const display =
          field.input.kind === 'number'
            ? `${value} ${MEASUREMENT_UNIT}`
            : String(value)
        return `<tr><td style="padding:4px 10px 4px 0;font-size:13px;color:#666;white-space:nowrap">${escapeHtml(field.label)}</td><td style="padding:4px 0;font-size:13px;font-weight:600">${escapeHtml(display)}</td></tr>`
      })
      .filter(Boolean)
    if (rows.length === 0) continue
    measurementRows += `<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${color};border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:6px">${escapeHtml(group.title)}</div><table style="border-collapse:collapse">${rows.join('')}</table></div>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Measurements - ${escapeHtml(customer.name)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    color: #1a1a1a;
    padding: 0;
    line-height: 1.4;
  }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div style="max-width:750px;margin:0 auto">
  <div style="border-bottom:2px solid ${color};padding-bottom:10px;margin-bottom:16px">
    <div style="font-size:20px;font-weight:700">${escapeHtml(customer.name)}</div>
    <div style="font-size:13px;color:#666;margin-top:2px">Phone: ${escapeHtml(customer.mobileNo)}</div>
    <div style="font-size:12px;color:#999;margin-top:2px">Measurements as of ${escapeHtml(formatMeasurementDate(measurement.date))}</div>
  </div>
  <div style="display:flex;gap:24px;align-items:flex-start">
    <div style="flex:1;min-width:0">
      ${measurementRows}
    </div>
  </div>
  <div style="margin-top:16px">
    <svg viewBox="${THOB_VIEW_BOX}" role="img" aria-label="Thob sketch with all measurements" style="width:100%;height:auto">
      ${svgContent}
    </svg>
  </div>
</div>
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
