import { cn } from '@/lib/utils'
import {
  MEASUREMENT_FIELDS,
  MEASUREMENT_UNIT,
  RESTING_MARKER_FIELDS,
  fieldsInView,
  measurementField,
} from '../data/measurement-fields'
import type {
  DiagramSegment,
  MeasurementField,
  MeasurementFieldName,
} from '../data/measurement-fields'
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
  THOB_WIDTH,
  THOB_HEIGHT,
} from '../data/thob-sketch'
import type { ThobView } from '../data/thob-sketch'

export type MeasurementValues = Partial<
  Record<MeasurementFieldName, string | number | null | undefined>
>

interface ThobDiagramProps {
  /** Field whose arrows are drawn highlighted; the resting set otherwise. */
  activeField?: string | null
  /** Entered values, shown on the callout labels. */
  values?: MeasurementValues
  /** Called when a callout is clicked, so a page can focus the input. */
  onSelectField?: (name: MeasurementFieldName) => void
  /** Which silhouette to draw against; the front by default. */
  view?: ThobView
  /**
   * Template mode: draw a callout for every field assigned to `view`, for a
   * read-only measurement chart. Off by default, which keeps the interactive
   * diagrams (form, customer sheet) on the front sketch with just the resting
   * markers.
   */
  showRecorded?: boolean
  className?: string
}

const ARROW_LENGTH = 8
const ARROW_HALF_WIDTH = 3

export interface DiagramCaption {
  x: number
  y: number
  w: number
  h: number
  text: string
}

/** Height and gap of a template-mode caption box, in diagram units. */
export const CAPTION_H = 20
const CAPTION_GAP = 2
const CAPTION_PAD = 1

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * The compact caption used on read-only templates. One value + a short label,
 * so boxes stay small enough to fit beside each other; the entry form still
 * uses `calloutText`. Only recorded values reach it — `layoutCaptions` skips
 * fields the snapshot didn't capture.
 */
export function diagramCaption(
  field: MeasurementField,
  value: string | number | null | undefined,
): string {
  if (value === undefined || value === null || value === '') {
    return field.diagramLabel
  }
  const unit = field.input.kind === 'number' ? ` ${MEASUREMENT_UNIT}` : ''
  return `${value}${unit} · ${field.diagramLabel}`
}

/** `true` when the snapshot actually captured a value for this field. */
function isRecorded(value: string | number | null | undefined) {
  return value !== undefined && value !== null && value !== ''
}

/**
 * SVG has no text metrics without measuring; the per-character estimate here
 * must stay in step with the Rust layout in `backend/features/orders/document.rs`
 * so the on-screen template reads the same as the printed one.
 */
function captionWidth(text: string) {
  return Math.max(44, text.length * 5 + 10)
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  const gap = CAPTION_GAP
  return (
    a.x + a.w + gap > b.x &&
    b.x + b.w + gap > a.x &&
    a.y + a.h + gap > b.y &&
    b.y + b.h + gap > a.y
  )
}

/**
 * Places one compact caption per recorded field for `view`, nudging boxes up
 * or down until none overlaps another (all boxes stay inside the frame).
 * Fields the snapshot didn't capture are skipped entirely, matching the Rust
 * layout in `backend/features/orders/document.rs`. Deterministic: fields are
 * placed in the order they read top-to-bottom on the sketch.
 */
export function layoutCaptions(
  fields: MeasurementField[],
  values: MeasurementValues | undefined,
): Map<MeasurementFieldName, DiagramCaption> {
  const byVertical = [...fields]
    .filter((field) => isRecorded(values?.[field.name]))
    .sort(
      (a, b) =>
        a.marker.label.y - b.marker.label.y ||
        a.marker.label.x - b.marker.label.x,
    )
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const captions = new Map<MeasurementFieldName, DiagramCaption>()

  for (const field of byVertical) {
    const text = diagramCaption(field, values?.[field.name])
    const w = captionWidth(text)
    const x = clamp(
      field.marker.label.x - w / 2,
      CAPTION_PAD,
      THOB_WIDTH - w - CAPTION_PAD,
    )
    const baseY = clamp(
      field.marker.label.y - CAPTION_H / 2,
      CAPTION_PAD,
      THOB_HEIGHT - CAPTION_H - CAPTION_PAD,
    )
    const slot = CAPTION_H + CAPTION_GAP

    let chosenY = baseY
    for (let step = 0; step < 9; step++) {
      const target =
        step === 0
          ? baseY
          : step % 2 === 1
            ? baseY + ((step + 1) / 2) * slot
            : baseY - (step / 2) * slot
      const candidate = clamp(
        target,
        CAPTION_PAD,
        THOB_HEIGHT - CAPTION_H - CAPTION_PAD,
      )
      const rect = { x, y: candidate, w, h: CAPTION_H }
      if (!placed.some((placedRect) => rectsOverlap(placedRect, rect))) {
        chosenY = candidate
        break
      }
      chosenY = candidate
    }

    placed.push({ x, y: chosenY, w, h: CAPTION_H })
    captions.set(field.name, { x, y: chosenY, w, h: CAPTION_H, text })
  }

  return captions
}

/** Triangle at (x, y) pointing along the outward direction (dx, dy). */
function arrowHead(x: number, y: number, dx: number, dy: number) {
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const baseX = x - ux * ARROW_LENGTH
  const baseY = y - uy * ARROW_LENGTH
  const px = -uy * ARROW_HALF_WIDTH
  const py = ux * ARROW_HALF_WIDTH
  return `M ${x} ${y} L ${baseX + px} ${baseY + py} L ${baseX - px} ${baseY - py} Z`
}

function DimensionLine({ x1, y1, x2, y2 }: DiagramSegment) {
  const dx = x2 - x1
  const dy = y2 - y1
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <path d={arrowHead(x1, y1, -dx, -dy)} fill="currentColor" />
      <path d={arrowHead(x2, y2, dx, dy)} fill="currentColor" />
    </g>
  )
}

export function calloutText(
  field: MeasurementField,
  value: string | number | null | undefined,
) {
  if (value === undefined || value === null || value === '') return field.label
  const suffix = field.input.kind === 'number' ? ` ${MEASUREMENT_UNIT}` : ''
  return `${field.label} · ${value}${suffix}`
}

function Callout({
  field,
  value,
  active,
  onSelect,
  caption,
}: {
  field: MeasurementField
  value: string | number | null | undefined
  active: boolean
  onSelect?: (name: MeasurementFieldName) => void
  caption?: DiagramCaption
}) {
  const { marker } = field
  const compact = Boolean(caption)
  const text = caption?.text ?? calloutText(field, value)
  // A chip grows when a value is filled in, so the markers parked against
  // the left and right margins have to slide back inside the frame.
  const rect = caption ?? computeChip(marker.label.x, marker.label.y, text)

  return (
    <g
      className={cn(
        active ? 'text-info' : 'text-muted-foreground/70',
        onSelect && 'cursor-pointer',
      )}
      onClick={onSelect ? () => onSelect(field.name) : undefined}
      data-testid={`callout-${field.name}`}
      data-active={active || undefined}
    >
      {marker.shapes?.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={active ? 2 : 1.5}
          strokeLinejoin="round"
        />
      ))}
      {marker.dots?.map((dot) => (
        <circle
          key={`${dot.cx}-${dot.cy}`}
          cx={dot.cx}
          cy={dot.cy}
          r={active ? 4.5 : 3.5}
          fill="currentColor"
        />
      ))}
      {marker.guides?.map((guide) => (
        <line
          key={`${guide.x1}-${guide.y1}-${guide.x2}-${guide.y2}`}
          x1={guide.x1}
          y1={guide.y1}
          x2={guide.x2}
          y2={guide.y2}
          stroke="currentColor"
          strokeWidth={0.75}
          strokeDasharray="3 3"
        />
      ))}
      {marker.dims?.map((dim) => (
        <DimensionLine
          key={`${dim.x1}-${dim.y1}-${dim.x2}-${dim.y2}`}
          {...dim}
        />
      ))}
      <g>
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={4}
          className="fill-background"
          stroke="currentColor"
          strokeWidth={active || !compact ? 0.9 : 0.5}
        />
        <text
          x={rect.x + rect.w / 2}
          y={rect.y + rect.h / 2 + 4}
          textAnchor="middle"
          fill="currentColor"
          className={cn(
            compact ? 'text-[8.5px]' : 'text-[13px]',
            active ? 'font-semibold' : 'font-medium',
          )}
        >
          {text}
        </text>
      </g>
    </g>
  )
}

function computeChip(labelX: number, labelY: number, text: string) {
  // SVG has no text metrics without measuring, and the labels are short —
  // a per-character estimate keeps the chip snug around the text.
  const width = Math.max(40, text.length * 7 + 18)
  const centeredX = clamp(labelX, width / 2 + 4, THOB_WIDTH - width / 2 - 4)
  return { x: centeredX - width / 2, y: labelY - 11, w: width, h: 22 }
}

export function ThobDiagram({
  activeField,
  values,
  onSelectField,
  view = 'front',
  showRecorded = false,
  className,
}: ThobDiagramProps) {
  const isBack = view === 'back'
  const active = activeField ? measurementField(activeField) : undefined
  const shown = showRecorded
    ? fieldsInView(view).filter((field) => isRecorded(values?.[field.name]))
    : active
      ? [active]
      : MEASUREMENT_FIELDS.filter((field) =>
          RESTING_MARKER_FIELDS.includes(field.name),
        )
  const captions = showRecorded ? layoutCaptions(shown, values) : null

  return (
    <svg
      viewBox={THOB_VIEW_BOX}
      role="img"
      aria-label={`Thob sketch, ${view} view, with measurement guides`}
      className={cn('w-full', className)}
    >
      {/* The garment itself — everything below is drawn in the muted
          sketch colour, and callouts redraw parts of it when highlighted. */}
      <g className="text-muted-foreground">
        <path
          d={THOB_OUTLINE}
          className="fill-muted/40"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
        {isBack ? (
          <>
            {[THOB_COLLAR, THOB_CUFFS].map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeLinejoin="round"
              />
            ))}
            <path
              d={THOB_CENTER_BACK_SEAM}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="4 3"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            {[THOB_COLLAR, THOB_PLACKET, THOB_CUFFS, THOB_SIDE_POCKETS].map(
              (d) => (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.25}
                  strokeLinejoin="round"
                />
              ),
            )}
            <path
              d={THOB_CHEST_POCKET}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinejoin="round"
            />
            <path
              d={THOB_MOBILE_POCKET}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="4 3"
              strokeLinejoin="round"
            />
          </>
        )}
        {(isBack
          ? THOB_SLEEVE_BUTTONS
          : [...THOB_BUTTONS, ...THOB_SLEEVE_BUTTONS]
        ).map((button) => (
          <circle
            key={`${button.cx}-${button.cy}`}
            cx={button.cx}
            cy={button.cy}
            r={2.5}
            fill="currentColor"
          />
        ))}
      </g>

      {shown.map((field) => (
        <Callout
          key={field.name}
          field={field}
          value={values?.[field.name]}
          active={Boolean(active)}
          onSelect={onSelectField}
          caption={captions?.get(field.name)}
        />
      ))}
    </svg>
  )
}
