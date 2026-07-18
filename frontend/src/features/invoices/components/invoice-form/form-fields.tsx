import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { InvoiceFormApi, NumberInput } from '../../types/invoice-form'

// Dynamic array paths (e.g. `customers[0].measurement.chest`) don't play
// well with TanStack Form's deep-key type inference, so field names are
// plain strings here rather than the library's `DeepKeys<T>` type.

interface FieldProps {
  form: InvoiceFormApi
  name: string
  label: string
}

// Errors come from the zod schema (lib/invoice-schema.ts) via TanStack
// Form's Standard Schema validator — each entry has a `.message`.
export function FieldError({ field }: { field: any }) {
  if (field.state.meta.errors.length === 0) return null
  return (
    <p className="text-xs font-medium text-destructive">
      {field.state.meta.errors
        .map((error: any) => error.message ?? error)
        .join(', ')}
    </p>
  )
}

export function TextField({ form, name, label }: FieldProps) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <div className="space-y-1">
          <Label htmlFor={field.name}>{label}</Label>
          <Input
            id={field.name}
            value={field.state.value ?? ''}
            aria-invalid={field.state.meta.errors.length > 0}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          <FieldError field={field} />
        </div>
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
        <div className="space-y-1">
          <Label htmlFor={field.name}>{label}</Label>
          <div className="relative">
            <Input
              id={field.name}
              type="number"
              inputMode="decimal"
              value={field.state.value ?? ''}
              aria-invalid={field.state.meta.errors.length > 0}
              onBlur={field.handleBlur}
              onChange={(e) => {
                const raw = e.target.value
                const next: NumberInput = raw === '' ? '' : Number(raw)
                field.handleChange(next)
              }}
              className={unit ? 'pe-10' : undefined}
            />
            {unit && (
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {unit}
              </span>
            )}
          </div>
          <FieldError field={field} />
        </div>
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
        <div className="space-y-1">
          <Label htmlFor={field.name}>{label}</Label>
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
          <FieldError field={field} />
        </div>
      )}
    </form.Field>
  )
}
