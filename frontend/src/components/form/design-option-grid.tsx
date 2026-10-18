import { memo } from 'react'
import { cn } from '@/lib/utils'

interface DesignOption {
  id: string
  label: string
  /** Absent for text-only options (rows with no uploaded illustration yet). */
  image?: string | null
}

interface DesignOptionGridProps {
  options: DesignOption[]
  value: string
  onChange: (value: string) => void
  columns?: number
  id?: string
}

// An image-per-choice radio group, in the spirit of SegmentedOptions but for
// choices that mean something visually (thob type, collar, sleeve, pocket,
// patti). Selected state keyed by option.id — the catalog id an order stores.
export const DesignOptionGrid = memo(function DesignOptionGrid({
  options,
  value,
  onChange,
  columns = 3,
  id,
}: DesignOptionGridProps) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Design options"
      className="grid max-h-72 gap-1.5 overflow-y-auto pr-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.id)}
          className={cn(
            'flex flex-col items-center gap-1 rounded-md border bg-background p-1 transition-colors',
            value === option.id
              ? 'border-primary bg-primary/10'
              : 'border-border hover:bg-muted hover:text-foreground',
          )}
        >
          {option.image ? (
            <img
              src={option.image}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className="h-16 w-full object-contain"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-16 w-full items-center justify-center rounded bg-muted px-1 text-center text-sm font-semibold text-muted-foreground"
            >
              {option.label}
            </span>
          )}
          <span
            className={cn(
              'line-clamp-2 w-full text-center text-[10px] leading-tight',
              value === option.id
                ? 'font-semibold text-primary'
                : 'text-muted-foreground',
            )}
          >
            {option.label}
          </span>
        </button>
      ))}
    </div>
  )
})
