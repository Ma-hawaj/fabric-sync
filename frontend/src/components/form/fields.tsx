import * as React from 'react'
import { useState } from 'react'
import {
  NumberField as NumberFieldRoot,
  NumberFieldGroup,
  NumberFieldInput,
} from '@/components/reui/number-field'
import { PhoneInput } from '@/components/reui/phone-input'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CalendarIcon, XIcon } from 'lucide-react'

// TanStack Form's extended API type has 11 validator generic params beyond
// the form data itself; pinning them all to `any` collapses several method
// signatures to `never` (a known quirk of erasing deep conditional/mapped
// types to `any`), which then rejects any concrete form's `useForm()`
// result. `AnyFormApi = any` sidesteps that — matching how this codebase
// already types individual field render props (`field: any`) rather than
// fighting the generics. Dynamic array paths (e.g.
// `items[0].details.value`) also don't play well with TanStack
// Form's deep-key type inference, so field names below are plain strings
// rather than the library's `DeepKeys<T>` type.
export type AnyFormApi = any

interface FieldProps {
  form: AnyFormApi
  name: string
  label: string
}

export function TextField({ form, name, label }: FieldProps) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Input
            id={field.name}
            value={field.state.value ?? ''}
            aria-invalid={field.state.meta.errors.length > 0}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
}

export function TextareaField({ form, name, label }: FieldProps) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Textarea
            id={field.name}
            rows={3}
            value={field.state.value ?? ''}
            aria-invalid={field.state.meta.errors.length > 0}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
}

export function PhoneField({
  form,
  name,
  label,
  defaultCountry,
}: FieldProps &
  Pick<React.ComponentProps<typeof PhoneInput>, 'defaultCountry'>) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <PhoneInput
            id={field.name}
            value={field.state.value ?? ''}
            aria-invalid={field.state.meta.errors.length > 0}
            onBlur={field.handleBlur}
            onChange={(value) => field.handleChange(value)}
            defaultCountry={defaultCountry}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
}

export function NumberField({
  form,
  name,
  label,
  unit,
}: FieldProps & { unit?: string }) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <NumberFieldRoot
            value={
              field.state.value === '' || field.state.value == null
                ? null
                : field.state.value
            }
            onValueChange={(value) => field.handleChange(value ?? '')}
          >
            <NumberFieldGroup>
              <NumberFieldInput
                id={field.name}
                aria-invalid={field.state.meta.errors.length > 0}
                onBlur={field.handleBlur}
                className={unit ? 'pe-10' : undefined}
              />
              {unit && (
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {unit}
                </span>
              )}
            </NumberFieldGroup>
          </NumberFieldRoot>
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
}

export function SelectField({
  form,
  name,
  label,
  options,
  placeholder,
}: FieldProps & { options: readonly string[]; placeholder?: string }) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Select
            value={field.state.value}
            onValueChange={(value: string) => field.handleChange(value)}
          >
            <SelectTrigger id={field.name} className="w-full">
              <SelectValue placeholder={placeholder ?? 'Select...'} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
}

// ISO calendar dates (`yyyy-mm-dd`) are parsed from their parts rather than
// `new Date(value)`, which reads the string as UTC midnight and can render
// the previous day behind a positive UTC offset.
function parseIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// A calendar popover for an ISO date string, blank when unset. The value
// stays a plain string like every other draft field — the Date object only
// exists while the calendar is open.
export function DateField({
  form,
  name,
  label,
  placeholder,
}: FieldProps & { placeholder?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <form.Field name={name as never}>
      {(field: any) => {
        const date = parseIsoDate(field.state.value ?? '')
        return (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            <div className="flex gap-2">
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      id={field.name}
                      variant="outline"
                      aria-invalid={field.state.meta.errors.length > 0}
                      className={cn(
                        'flex-1 justify-start font-normal',
                        !date && 'text-muted-foreground',
                      )}
                    />
                  }
                >
                  <CalendarIcon />
                  <span className="truncate">
                    {date
                      ? date.toLocaleDateString()
                      : (placeholder ?? 'Pick a date')}
                  </span>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    autoFocus
                    captionLayout="dropdown"
                    endMonth={new Date(new Date().getFullYear() + 10, 11)}
                    mode="single"
                    selected={date}
                    onSelect={(selected) => {
                      field.handleChange(selected ? toIsoDate(selected) : '')
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
                onClick={() => field.handleChange('')}
                className={cn(!date && 'invisible')}
              >
                <XIcon />
              </Button>
            </div>
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )
      }}
    </form.Field>
  )
}
