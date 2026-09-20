import { cn } from '@/lib/utils'

interface DesignOption {
  id: string
  label: string
  image: string
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
export function DesignOptionGrid({
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
          <img
            src={option.image}
            alt=""
            draggable={false}
            className="h-16 w-full object-contain"
          />
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
}
