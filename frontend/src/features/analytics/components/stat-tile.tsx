import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatDelta } from '../lib/format'

interface StatTileProps {
  label: string
  value: string
  /** A second line under the value — a share, a count, a caveat. */
  hint?: string
  /** Percentage change against the previous period; null when there isn't one. */
  delta?: number | null
  deltaLabel?: string
  /**
   * True where a fall is the good news — outstanding balance, rework. The
   * arrow still points the way the number moved; only the colour flips.
   */
  lowerIsBetter?: boolean
  /** The one figure the page leads with. Exactly one tile sets this. */
  hero?: boolean
  className?: string
}

export function StatTile({
  label,
  value,
  hint,
  delta = null,
  deltaLabel,
  lowerIsBetter = false,
  hero = false,
  className,
}: StatTileProps) {
  const rising = delta !== null && delta > 0
  const good = lowerIsBetter ? !rising : rising
  const Arrow = rising ? ArrowUpRightIcon : ArrowDownRightIcon

  return (
    <Card className={cn('justify-between gap-2', className)} size="sm">
      <div className="px-(--card-spacing)">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            // A three-decimal currency runs long: the hero has two columns to
            // spread into, the rest sit one to a column and need the smaller
            // step to keep the amount whole.
            'mt-1 font-semibold tracking-tight',
            hero ? 'text-4xl sm:text-5xl' : 'text-xl',
          )}
        >
          {value}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-(--card-spacing) text-xs text-muted-foreground">
        {delta !== null && delta !== 0 ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              good ? 'text-chart-positive' : 'text-chart-negative',
            )}
          >
            <Arrow className="size-3.5" aria-hidden />
            {formatDelta(delta)}
          </span>
        ) : null}
        {delta !== null && delta !== 0 && deltaLabel ? (
          <span>{deltaLabel}</span>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </div>
    </Card>
  )
}
