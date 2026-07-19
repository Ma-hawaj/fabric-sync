import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// TanStack Form's extended API type has 11 validator generic params beyond
// the form data itself; pinning them all to `any` collapses several method
// signatures to `never` (a known quirk of erasing deep conditional/mapped
// types to `any`), which then rejects any concrete form's `useForm()`
// result. `AnyFormApi = any` sidesteps that — matching how this codebase
// already types individual field render props (`field: any`) rather than
// fighting the generics. Dynamic array paths (e.g.
// `customers[0].measurement.chest`) also don't play well with TanStack
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
                field.handleChange(raw === '' ? '' : Number(raw))
              }}
              className={unit ? 'pe-10' : undefined}
            />
            {unit && (
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {unit}
              </span>
            )}
          </div>
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
