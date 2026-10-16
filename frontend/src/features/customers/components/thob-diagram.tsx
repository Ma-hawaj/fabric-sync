import { cn } from '@/lib/utils'
import type { MeasurementFieldName } from '../data/measurement-fields'

export type MeasurementValues = Partial<
  Record<MeasurementFieldName, string | number | null | undefined>
>

/**
 * Thobe measurement sheet (front + back) as an inline SVG — promoted from
 * the standalone `Thobe.jsx` prototype.
 *
 * Every field on the sheet is a key of the `values` prop:
 *
 *   <ThobDiagram values={{ neckSize: 16, chest: 41 }} />
 *
 * The front-pocket L×W stays ONE text slot (`frontPocketLengthByWidth`,
 * e.g. "16x14") — the prototype's split P.L/P.W pair was merged rather than
 * splitting the stored field.
 *
 * `activeField` / `onSelectField` / `view` / `showRecorded` are accepted for
 * prop-stability with existing callers but currently ignored: hover
 * highlighting is deferred to a later pass, and the sheet always draws front
 * and back together in one SVG (there are no per-view silhouettes).
 */
interface ThobDiagramProps {
  activeField?: string | null
  values?: MeasurementValues
  onSelectField?: (name: MeasurementFieldName) => void
  view?: 'front' | 'back'
  showRecorded?: boolean
  showLabels?: boolean
  placeholder?: string | null
  width?: string
  stroke?: string
  className?: string
}

interface ValueSlot {
  id: string
  key: string
  label: string
  x: number
  y: number
  size: number
}

// id: unique slot on the drawing   key: name in `values`
// x,y: text position (baseline, centred)   size: font size
export const THOBE_VALUE_SLOTS: ValueSlot[] = [
  // ---------------- FRONT ----------------
  {
    id: 'neckSize',
    key: 'neckSize',
    label: 'Neck Size',
    x: 272,
    y: -4,
    size: 18,
  },
  {
    id: 'shoulderF',
    key: 'shoulderDown',
    label: 'Shoulder Down',
    x: 320,
    y: 2,
    size: 18,
  },
  { id: 'chestUp', key: 'chestUp', label: 'Chest Up', x: 153, y: 86, size: 16 },
  {
    id: 'frontPocketLength',
    key: 'frontPocketLength',
    label: 'Front Pocket Length',
    x: 246,
    y: 120,
    size: 15,
  },
  // One slot for the stored "L×W" text (e.g. "16x14") — merged from the
  // prototype's split P.L/P.W pair so the field is never split.
  {
    id: 'pocketLxW',
    key: 'frontPocketLengthByWidth',
    label: 'Pocket L×W',
    x: 258,
    y: 165,
    size: 13,
  },
  { id: 'fo', key: 'fo', label: 'Fo', x: 193, y: 152, size: 15 },
  {
    id: 'foWidth',
    key: 'foWidth',
    label: 'Fo Width',
    x: 214,
    y: 254,
    size: 16,
  },
  {
    id: 'cuffWidth',
    key: 'cuffWidth',
    label: 'Cuff Width',
    x: 68,
    y: 301,
    size: 13,
  },
  {
    id: 'cuffSize',
    key: 'cuffSize',
    label: 'Cuff Size',
    x: 66,
    y: 346,
    size: 18,
  },
  {
    id: 'sidePocket',
    key: 'sidePocket',
    label: 'Side Pocket',
    x: 274,
    y: 364,
    size: 18,
  },
  {
    id: 'frontHeight',
    key: 'frontHeight',
    label: 'Front Height',
    x: 199,
    y: 492,
    size: 22,
  },
  {
    id: 'bottomFold',
    key: 'bottomFold',
    label: 'Bottom Fold',
    x: 364,
    y: 620,
    size: 18,
  },
  // ---------------- BACK -----------------
  {
    id: 'neckWidth',
    key: 'neckWidth',
    label: 'Neck Width',
    x: 630,
    y: 20,
    size: 18,
  },
  {
    id: 'shoulderB',
    key: 'shoulderDown',
    label: 'Shoulder Down',
    x: 433,
    y: 48,
    size: 18,
  },
  { id: 'armhole', key: 'armhole', label: 'Armhole', x: 713, y: 50, size: 18 },
  {
    id: 'fullBody',
    key: 'fullBody',
    label: 'Full Body',
    x: 567.5,
    y: 93,
    size: 17,
  },
  { id: 'chest', key: 'chest', label: 'Chest', x: 520, y: 134, size: 20 },
  {
    id: 'sleeveHalf',
    key: 'sleeveHalf',
    label: 'Sleeve Half',
    x: 675,
    y: 154,
    size: 14,
  },
  { id: 'waist', key: 'waist', label: 'Waist', x: 520, y: 215, size: 20 },
  { id: 'hip', key: 'hip', label: 'Hip', x: 520, y: 305, size: 20 },
  {
    id: 'sleeveLength',
    key: 'sleeveLength',
    label: 'Sleeve Length',
    x: 756,
    y: 214,
    size: 18,
  },
  {
    id: 'openFold',
    key: 'openFold',
    label: 'Open Fold',
    x: 712,
    y: 303,
    size: 13,
  },
  {
    id: 'openHand',
    key: 'openHand',
    label: 'Open Hand',
    x: 712,
    y: 356,
    size: 20,
  },
  {
    id: 'backHeight',
    key: 'backHeight',
    label: 'Back Height',
    x: 567.5,
    y: 492,
    size: 22,
  },
  { id: 'bottom', key: 'bottom', label: 'Bottom', x: 724, y: 622, size: 18 },
]

export const THOBE_FIELDS = THOBE_VALUE_SLOTS.filter(
  (f, i, a) => a.findIndex((g) => g.key === f.key) === i,
).map(({ key, label }) => ({ key, label }))

export const THOBE_VIEWBOX = '0 -32 800 667'

/** Fill colour for the dimension arrowheads. */
export const THOBE_ARROW_FILL = '#222'

export interface GarmentPath {
  d: string
  grey?: boolean
  dashed?: boolean
}

export interface GarmentEllipse {
  cx: number
  cy: number
  rx: number
  ry: number
  rotate?: { angle: number; cx: number; cy: number }
  strokeWidth?: number
  grey?: boolean
  /** Render only when the named slot has a recorded value. */
  when?: string
}

/** Front silhouette strokes (collar, shoulders, sleeves, body, placket, pocket). */
export const THOBE_FRONT_PATHS: GarmentPath[] = [
  { d: 'M181 35 Q146 44 108.5 67' },
  { d: 'M181 41 Q148 50 113.5 71' },
  { d: 'M246 35 Q282 44 319 67' },
  { d: 'M246 41 Q280 50 317.5 71' },
  { d: 'M108.5 68 L39.5 298' },
  { d: 'M108.5 68 Q122 90 126 112' },
  { d: 'M125.5 200 L92 313' },
  { d: 'M46.5 274.5 Q72.8 277.9 99 289' },
  { d: 'M320 68 L388.75 298.75' },
  { d: 'M320 68 Q305 91 301 114' },
  { d: 'M303 198 L337 313.75' },
  { d: 'M330 289.3 Q354.5 275.5 382 275.7' },
  { d: 'M126 112 Q124 330 110 602' },
  { d: 'M301 114 Q303 330 320 602' },
  { d: 'M126 70 V112 M300 70 V114', grey: true },
  { d: 'M110 580 Q215 625 320 580' },
  { d: 'M110 602 Q215 648 320 602' },
  { d: 'M181 40 V600' },
  { d: 'M205 50 V218 L213.5 231 L222 218 V52' },
  { d: 'M205 205 H222' },
  { d: 'M235 128.5 H290.5 V174 L281.5 185 H242.5 L235 174 Z' },
  { d: 'M235 136 H290.5' },
]

export const THOBE_FRONT_ELLIPSES: GarmentEllipse[] = [
  { cx: 213.5, cy: 39.5, rx: 32.5, ry: 24.5 },
  { cx: 213.5, cy: 39, rx: 32.5, ry: 11.5 },
  {
    cx: 65.75,
    cy: 305.5,
    rx: 27.3,
    ry: 7.5,
    rotate: { angle: 16, cx: 65.75, cy: 305.5 },
  },
  {
    cx: 362.9,
    cy: 306.25,
    rx: 26.9,
    ry: 7.5,
    rotate: { angle: -16.2, cx: 362.9, cy: 306.25 },
  },
]

/** Back silhouette strokes (collar, shoulders, sleeves, body, yoke). */
export const THOBE_BACK_PATHS: GarmentPath[] = [
  { d: 'M535 36 L537 25 Q541 15 567.5 15 Q594 15 598 25 L600 36 Z' },
  { d: 'M535 36 Q499 46 462 68.5' },
  { d: 'M600 36 Q636 46 672 68' },
  { d: 'M462 68.5 L398.75 297.5' },
  { d: 'M462 68.5 L479 116' },
  { d: 'M478.5 198 L448.5 313.5' },
  { d: 'M405 274.5 Q431.3 273 455.4 287' },
  { d: 'M672 68 L735 300' },
  { d: 'M672 68 L653 116' },
  { d: 'M653.5 199 L684.5 315' },
  { d: 'M677.4 288 Q701 275.9 728.3 275.5' },
  { d: 'M479 116 Q477 330 463 605' },
  { d: 'M653 116 Q656 330 679 605' },
  { d: 'M463 587 Q571 633 679 587' },
  { d: 'M463 605 Q571 650 679 605' },
  { d: 'M567.5 36 V610' },
  { d: 'M672 67.5 H677.5 L741.5 299 H735', dashed: true },
]

export const THOBE_BACK_ELLIPSES: GarmentEllipse[] = [
  // The yoke circle doubles as the full-body callout anchor — drawn only
  // when that value was recorded.
  { cx: 567.5, cy: 88, rx: 62, ry: 13, strokeWidth: 1, when: 'fullBody' },
  {
    cx: 423.6,
    cy: 305.5,
    rx: 26.1,
    ry: 7.5,
    rotate: { angle: 17.8, cx: 423.6, cy: 305.5 },
  },
  {
    cx: 709.75,
    cy: 307.5,
    rx: 26.3,
    ry: 7.5,
    rotate: { angle: -16.5, cx: 709.75, cy: 307.5 },
  },
]

/** Thin dimension/leader lines, front and back. */
export const THOBE_FRONT_DIMS: string[] = [
  'M320 8 V56',
  'M128 92 H299',
  'M246 42 V105',
  'M262 -1 L226 31',
  'M297 330 V392',
  'M322 604 L342 612',
]

export const THOBE_BACK_DIMS: string[] = [
  'M468 64 L452 53.5',
  'M676 65 L697 53',
  'M598 25 L618 17',
  'M653 118 H554',
  'M653 199 H554',
  'M479 117 H488',
  'M479 199 H490',
  'M476 289 H490',
  'M556 289 H656',
  'M655 160 H695',
  'M681 607 L702 614',
]

/** Filled arrowheads for the dimension lines. */
export const THOBE_FRONT_ARROWS: string[] = [
  'M320 64 l-4.5 -9 h9 z',
  'M128 92 l8 -3.5 v7 z',
  'M299 92 l-8 -3.5 v7 z',
  'M246 105 l-3.5 -8 h7 z',
  'M297 330 l-3.5 8 h7 z',
  'M297 392 l-3.5 -8 h7 z',
]

export const THOBE_BACK_ARROWS: string[] = [
  'M449.5 52 l9.5 1.5 l-4.5 7 z',
  'M698.5 52 l-9.5 0 l3.5 7.5 z',
  'M549 118 l9 -4 v8 z',
  'M495 117 l-8 -3.5 v7 z',
  'M549 199 l9 -4 v8 z',
  'M497 199 l-7 -3.5 v7 z',
  'M497 289 l-7 -3.5 v7 z',
  'M553 289 l7 -3.5 v7 z',
  'M655 160 l7 -3 v6 z',
  'M695 160 l-7 -3 v6 z',
]

function ellipseTransform(e: GarmentEllipse) {
  return e.rotate
    ? `rotate(${e.rotate.angle} ${e.rotate.cx} ${e.rotate.cy})`
    : undefined
}

export function ThobDiagram({
  values = {},
  showLabels = false,
  placeholder = null,
  width = '100%',
  // currentColor so the sheet follows the theme (light and dark) instead of
  // hardcoding ink. The print exports keep their own dark-on-paper colours.
  stroke = 'currentColor',
  className,
}: ThobDiagramProps) {
  const m = values as Record<string, string | number | null | undefined>
  const isRecorded = (key: string) => {
    const v = m[key]
    return v !== undefined && v !== null && v !== ''
  }
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: 1.2,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  } as const
  const dim = { fill: 'none', stroke, strokeWidth: 1 } as const

  return (
    <svg
      viewBox={THOBE_VIEWBOX}
      width={width}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Thobe measurements"
      className={cn('w-full text-foreground', className)}
    >
      {/* ===================== FRONT ===================== */}
      <g {...common}>
        {THOBE_FRONT_ELLIPSES.map((e, i) => (
          <ellipse
            key={i}
            cx={e.cx}
            cy={e.cy}
            rx={e.rx}
            ry={e.ry}
            transform={ellipseTransform(e)}
          />
        ))}
        {THOBE_FRONT_PATHS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            stroke={p.grey ? '#999' : undefined}
            strokeWidth={p.grey ? 0.8 : undefined}
          />
        ))}
      </g>

      {/* front dimension lines */}
      <g {...dim}>
        {THOBE_FRONT_DIMS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g fill={stroke}>
        {THOBE_FRONT_ARROWS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* ===================== BACK ===================== */}
      <g {...common}>
        {THOBE_BACK_ELLIPSES.filter((e) => !e.when || isRecorded(e.when)).map(
          (e, i) => (
            <ellipse
              key={i}
              cx={e.cx}
              cy={e.cy}
              rx={e.rx}
              ry={e.ry}
              strokeWidth={e.strokeWidth}
              transform={ellipseTransform(e)}
            />
          ),
        )}
        {THOBE_BACK_PATHS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            strokeDasharray={p.dashed ? '6 3' : undefined}
            strokeWidth={p.dashed ? 1 : undefined}
          />
        ))}
      </g>

      {/* back dimension lines */}
      <g {...dim}>
        {THOBE_BACK_DIMS.map((d, i) => (
          <path
            key={i}
            d={d}
            strokeWidth={d.includes('53') ? 0.9 : undefined}
          />
        ))}
      </g>
      <g fill={stroke}>
        {THOBE_BACK_ARROWS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* ===================== NUMBERS ===================== */}
      <g fontFamily="Arial, sans-serif">
        {THOBE_VALUE_SLOTS.map((f) => {
          const v = m[f.key]
          const has = v !== undefined && v !== null && v !== ''
          if (!has && placeholder == null && !showLabels) return null
          const items: {
            x: number
            y: number
            size: number
            opacity: number
            anchor: string
            str: string
          }[] = []
          if (showLabels) {
            items.push({
              x: f.x,
              y: f.y - f.size * 0.85 - 2,
              size: 9,
              opacity: 0.6,
              anchor: 'middle',
              str: f.label,
            })
          }
          const text = has ? String(v) : placeholder
          if (text != null) {
            items.push({
              x: f.x,
              y: f.y,
              size: f.size,
              opacity: has ? 1 : 0.45,
              anchor: 'middle',
              str: text,
            })
          }
          return (
            <g key={f.id} data-testid={`value-${f.id}`}>
              <title>{f.label}</title>
              {items.map((it, k) => (
                <g key={k}>
                  <text
                    x={it.x}
                    y={it.y}
                    fontSize={it.size}
                    textAnchor={it.anchor as 'middle'}
                    fill="none"
                    stroke="var(--color-background)"
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                  >
                    {it.str}
                  </text>
                  <text
                    x={it.x}
                    y={it.y}
                    fontSize={it.size}
                    textAnchor={it.anchor as 'middle'}
                    fill="currentColor"
                    fillOpacity={it.opacity}
                  >
                    {it.str}
                  </text>
                </g>
              ))}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
