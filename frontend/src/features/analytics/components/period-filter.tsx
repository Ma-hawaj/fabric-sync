import { cn } from '@/lib/utils'
import { ANALYTICS_PERIODS } from '../lib/period'
import type { AnalyticsPeriod } from '../lib/period'

interface PeriodFilterProps {
  value: AnalyticsPeriod
  onChange: (period: AnalyticsPeriod) => void
}

/**
 * One filter row above everything it scopes — every figure and chart on the
 * page re-renders against the same slice, so there are no per-card controls
 * to keep in step.
 */
export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Reporting period"
      className="inline-flex flex-wrap gap-1 rounded-lg border bg-background p-1"
    >
      {ANALYTICS_PERIODS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === option.value
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
