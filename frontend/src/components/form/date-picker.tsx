import { useState } from 'react'
import { CalendarIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { parseFilterDate, serializeFilterDate } from '@/lib/filter-date'
import { cn } from '@/lib/utils'

// Keep calendar dates as ISO strings, without converting them through UTC.
export function DatePicker({
  id,
  label,
  value,
  onValueChange,
  placeholder = 'Pick a date',
  invalid,
  className,
}: {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parseFilterDate(value)
    : undefined
  return (
    <div className={cn('flex gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              aria-invalid={invalid}
              className={cn(
                'flex-1 justify-start font-normal',
                !date && 'text-muted-foreground',
              )}
            />
          }
        >
          <CalendarIcon />
          <span className="truncate">
            {date ? date.toLocaleDateString() : placeholder}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            autoFocus
            captionLayout="dropdown"
            endMonth={new Date(new Date().getFullYear() + 10, 11)}
            defaultMonth={date}
            mode="single"
            selected={date}
            onSelect={(selected) => {
              onValueChange(serializeFilterDate(selected))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label={`Clear ${label}`}
        onClick={() => onValueChange('')}
        className={cn(!date && 'invisible')}
      >
        <XIcon />
      </Button>
    </div>
  )
}
