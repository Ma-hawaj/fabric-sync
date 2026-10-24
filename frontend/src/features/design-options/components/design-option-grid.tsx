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
  density?: 'compact' | 'comfortable'
}

// An image-per-choice radio group, in the spirit of SegmentedOptions but for
// choices that mean something visually (thob type, collar, sleeve, pocket,
// patti). Selected state is keyed by the catalog value stored on an order.
export const DesignOptionGrid = memo(function DesignOptionGrid({
  options,
  value,
  onChange,
  columns = 3,
  id,
  density = 'compact',
}: DesignOptionGridProps) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Design options"
      className={cn(
        'grid gap-2 overflow-y-auto pe-1',
        density === 'comfortable' ? 'max-h-[50dvh]' : 'max-h-72',
      )}
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
            'flex flex-col items-center gap-2 rounded-md border bg-background transition-colors',
            density === 'comfortable' ? 'p-3' : 'p-1',
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
              className={cn(
                'w-full object-contain',
                density === 'comfortable' ? 'h-24' : 'h-16',
              )}
            />
          ) : (
            <span
              aria-hidden
              className={cn(
                'flex w-full items-center justify-center rounded bg-muted px-1 text-center text-sm font-semibold text-muted-foreground',
                density === 'comfortable' ? 'h-24' : 'h-16',
              )}
            >
              {option.label}
            </span>
          )}
          <span
            className={cn(
              'w-full text-center leading-tight',
              density === 'comfortable'
                ? 'text-xs'
                : 'line-clamp-2 text-[10px]',
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
