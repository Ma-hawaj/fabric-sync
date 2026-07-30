import { cn } from '@/lib/utils'
import {
  MEASUREMENT_FIELDS,
  RESTING_MARKER_FIELDS,
  measurementField,
} from '../data/measurement-fields'
import type {
  DiagramSegment,
  MeasurementField,
  MeasurementFieldName,
} from '../data/measurement-fields'
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
  className?: string
}

const ARROW_LENGTH = 8
const ARROW_HALF_WIDTH = 3

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
  const suffix = field.input.kind === 'number' ? ' cm' : ''
  return `${field.label} · ${value}${suffix}`
}

function Callout({
  field,
  value,
  active,
  onSelect,
}: {
  field: MeasurementField
  value: string | number | null | undefined
  active: boolean
  onSelect?: (name: MeasurementFieldName) => void
}) {
  const { marker } = field
  const text = calloutText(field, value)
  // SVG has no text metrics without measuring, and the labels are short —
  // a per-character estimate keeps the chip snug around the text.
  const width = Math.max(40, text.length * 7 + 18)
  // A chip grows when a value is filled in, so the markers parked against
  // the left and right margins have to slide back inside the frame.
  const labelX = Math.min(
    Math.max(marker.label.x, width / 2 + 4),
    THOB_WIDTH - width / 2 - 4,
  )

  return (
    <g
      className={cn(
        active
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-muted-foreground/70',
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
          x={labelX - width / 2}
          y={marker.label.y - 11}
          width={width}
          height={22}
          rx={6}
          className="fill-background"
          stroke="currentColor"
          strokeWidth={active ? 1.25 : 0.75}
        />
        <text
          x={labelX}
          y={marker.label.y + 4}
          textAnchor="middle"
          fill="currentColor"
          className={cn(
            'text-[13px]',
            active ? 'font-semibold' : 'font-medium',
          )}
        >
          {text}
        </text>
      </g>
    </g>
  )
}

export function ThobDiagram({
  activeField,
  values,
  onSelectField,
  className,
}: ThobDiagramProps) {
  const active = activeField ? measurementField(activeField) : undefined
  const shown = active
    ? [active]
    : MEASUREMENT_FIELDS.filter((field) =>
        RESTING_MARKER_FIELDS.includes(field.name),
      )

  return (
    <svg
      viewBox={THOB_VIEW_BOX}
      role="img"
      aria-label="Thob sketch with measurement guides"
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
        {[THOB_COLLAR, THOB_PLACKET, THOB_CUFFS, THOB_SIDE_POCKETS].map((d) => (
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
        {[...THOB_BUTTONS, ...THOB_SLEEVE_BUTTONS].map((button) => (
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
        />
      ))}
    </svg>
  )
}
