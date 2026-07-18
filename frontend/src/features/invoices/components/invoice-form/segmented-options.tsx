import { cn } from '@/lib/utils'

interface SegmentedOptionsProps {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
  columns?: number
  id?: string
}

export function SegmentedOptions({
  options,
  value,
  onChange,
  columns = 2,
  id,
}: SegmentedOptionsProps) {
  return (
    <div
      id={id}
      role="radiogroup"
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
            value === option
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
