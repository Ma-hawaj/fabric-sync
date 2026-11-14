import * as React from 'react'
import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field'
import { PhoneInput } from '@/components/reui/phone-input'
import { DatePicker } from '@/components/form/date-picker'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MinusIcon, PlusIcon } from 'lucide-react'

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
  const errorId = React.useId()
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
            aria-describedby={
              field.state.meta.errors.length > 0 ? errorId : undefined
            }
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          <FieldError id={errorId} errors={field.state.meta.errors} />
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
  min,
  max,
  step,
  format,
  showControls = false,
}: FieldProps &
  Pick<NumberFieldPrimitive.Root.Props, 'min' | 'max' | 'step' | 'format'> & {
    unit?: string
    showControls?: boolean
  }) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <NumberFieldPrimitive.Root
            min={min}
            max={max}
            step={step}
            format={format}
            value={
              field.state.value === '' || field.state.value == null
                ? null
                : field.state.value
            }
            onValueChange={(value) => field.handleChange(value ?? '')}
          >
            <NumberFieldPrimitive.Group render={<InputGroup />}>
              {showControls && (
                <InputGroupAddon>
                  <NumberFieldPrimitive.Decrement
                    aria-label={`Decrease ${label}`}
                    render={<InputGroupButton size="icon-xs" />}
                  >
                    <MinusIcon />
                  </NumberFieldPrimitive.Decrement>
                </InputGroupAddon>
              )}
              <NumberFieldPrimitive.Input
                render={<InputGroupInput />}
                id={field.name}
                aria-invalid={field.state.meta.errors.length > 0}
                onBlur={field.handleBlur}
              />
              {unit && (
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{unit}</InputGroupText>
                </InputGroupAddon>
              )}
              {showControls && (
                <InputGroupAddon align="inline-end">
                  <NumberFieldPrimitive.Increment
                    aria-label={`Increase ${label}`}
                    render={<InputGroupButton size="icon-xs" />}
                  >
                    <PlusIcon />
                  </NumberFieldPrimitive.Increment>
                </InputGroupAddon>
              )}
            </NumberFieldPrimitive.Group>
          </NumberFieldPrimitive.Root>
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

// Form binding for the shared ISO date picker, blank when unset.
export function DateField({
  form,
  name,
  label,
  placeholder,
}: FieldProps & { placeholder?: string }) {
  return (
    <form.Field name={name as never}>
      {(field: any) => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <DatePicker
            id={field.name}
            label={label}
            value={field.state.value ?? ''}
            onValueChange={(value) => field.handleChange(value)}
            placeholder={placeholder}
            invalid={field.state.meta.errors.length > 0}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
}
