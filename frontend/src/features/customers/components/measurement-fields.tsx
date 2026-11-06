import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NumberField, SelectField, TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import type { AnyFormApi } from '@/components/form/fields'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ThobDiagram } from './thob-diagram'
import type { MeasurementValues } from './thob-diagram'
import {
  MEASUREMENT_FIELDS,
  MEASUREMENT_GROUPS,
  MEASUREMENT_UNIT,
  fieldsInGroup,
} from '../data/measurement-fields'
import type { MeasurementField } from '../data/measurement-fields'
import type { Measurement } from '../types/customers'
import type { MeasurementDraft } from '../types/measurement-form'
import {
  MEASUREMENT_FITS,
  MEASUREMENT_TYPES,
  createEmptyMeasurement,
} from '../types/measurement-form'

export function snapshotLabel(
  snapshot: Measurement,
  idx: number,
  total: number,
) {
  const date = new Date(snapshot.date).toLocaleDateString()
  const status = idx === 0 ? 'Current' : `Previous #${total - idx}`
  return `${snapshot.readableId} · ${status} (${date})`
}

export function measurementFromSnapshot(
  snapshot: Measurement | null,
): MeasurementDraft {
  // Start from draft defaults, then copy across whatever the snapshot recorded.
  const draft = createEmptyMeasurement() as MeasurementDraft &
    Record<string, unknown>
  draft.loadedFromId = snapshot?.id ?? null
  // Saving always creates a new record, dated today, regardless of which
  // historical snapshot it started from.
  draft.date = new Date().toISOString().slice(0, 10)

  if (snapshot) {
    for (const { name } of MEASUREMENT_FIELDS) {
      const value = snapshot[name]
      // Widened to a string key so the write goes through the index
      // signature: each field's own type is narrower than the union.
      if (value !== undefined) draft[name as string] = value
    }
    // Type and fit live on the draft but outside the diagram catalog (plain
    // details, no sketch callouts), so they don't ride the loop above.
    // A legacy snapshot may arrive null: require its type and use the default fit.
    draft.type = snapshot.type ?? ''
    draft.fit = snapshot.fit ?? draft.fit
  }

  return draft
}

/** Reads `customers[0].measurement`-style paths out of the form values. */
function readAt(values: unknown, path: string) {
  return path
    .split(/[.[\]]+/)
    .filter(Boolean)
    .reduce<any>((acc, key) => (acc == null ? acc : acc[key]), values)
}

function FieldInput({
  form,
  base,
  field,
}: {
  form: AnyFormApi
  base: string
  field: MeasurementField
}) {
  const name = `${base}.${field.name}`

  if (field.input.kind === 'number') {
    return (
      <NumberField
        form={form}
        name={name}
        label={field.label}
        unit={MEASUREMENT_UNIT}
      />
    )
  }
  if (field.input.kind === 'select') {
    return (
      <SelectField
        form={form}
        name={name}
        label={field.label}
        options={field.input.options}
      />
    )
  }
  return <TextField form={form} name={name} label={field.label} />
}

interface MeasurementFieldsProps {
  form: AnyFormApi
  basePath: string
  history: Measurement[]
}

export function MeasurementFields({
  form,
  basePath,
  history,
}: MeasurementFieldsProps) {
  const base = basePath
  // Hover wins over focus so pointing at one field while another is focused
  // shows what the pointer is on, and dropping the pointer falls back to the
  // focused field rather than clearing the sheet.
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const activeField = hovered ?? focused

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Measurements</h3>
      </div>

      {history.length > 0 && (
        <form.Field name={`${base}.loadedFromId` as never}>
          {(field: any) => (
            <div className="space-y-1">
              <Label htmlFor={field.name}>Start Measurements From</Label>
              <Select
                items={history.map((snapshot, idx) => ({
                  value: snapshot.id,
                  label: snapshotLabel(snapshot, idx, history.length),
                }))}
                value={field.state.value ?? history[0]?.id}
                onValueChange={(snapshotId: string) => {
                  const snapshot =
                    history.find((m) => m.id === snapshotId) ?? null
                  form.setFieldValue(base, measurementFromSnapshot(snapshot))
                }}
              >
                <SelectTrigger id={field.name} className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="w-max max-w-(--available-width)">
                  {history.map((snapshot, idx) => (
                    <SelectItem
                      key={snapshot.id}
                      value={snapshot.id}
                      className="pe-7 [&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:wrap-anywhere [&>:first-child]:whitespace-normal"
                    >
                      {snapshotLabel(snapshot, idx, history.length)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
      )}

      {/* Container queries, not viewport ones: these fields are also
          embedded in the (narrower) invoice form. The sketch belongs on the
          right wherever it fits, so the two-column layout starts as soon as
          there is room for it and the column widens from there; only a
          genuinely narrow container stacks them. */}
      <div className="@container">
        <div className="grid gap-5 @2xl:grid-cols-[minmax(16rem,35%)_1fr]">
          <div className="order-2 space-y-5 @2xl:order-1">
            {/* Record-level details, not lengths: what was measured and how
                to cut it. These have no sketch callout — they
                describe the record rather than a point on the garment. */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Record Details
              </h4>
              <div className="grid gap-3">
                <form.Field name={`${base}.type` as never}>
                  {(field: any) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor={field.name}>Type</FieldLabel>
                      <SegmentedOptions
                        id={field.name}
                        ariaLabel="Type"
                        columns={3}
                        options={MEASUREMENT_TYPES.map(
                          (option) =>
                            option.charAt(0).toUpperCase() + option.slice(1),
                        )}
                        value={
                          field.state.value.charAt(0).toUpperCase() +
                          field.state.value.slice(1)
                        }
                        onChange={(value) =>
                          field.handleChange(value.toLowerCase())
                        }
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
                <form.Field name={`${base}.fit` as never}>
                  {(field: any) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor={field.name}>Fit</FieldLabel>
                      <SegmentedOptions
                        id={`${field.name}.options`}
                        ariaLabel="Fit"
                        columns={3}
                        options={MEASUREMENT_FITS.map(
                          (option) =>
                            option.charAt(0).toUpperCase() + option.slice(1),
                        )}
                        value={
                          field.state.value.charAt(0).toUpperCase() +
                          field.state.value.slice(1)
                        }
                        onChange={(value) =>
                          field.handleChange(value.toLowerCase())
                        }
                      />
                      <Input
                        id={field.name}
                        placeholder="Or enter a custom fit"
                        value={field.state.value}
                        aria-invalid={field.state.meta.errors.length > 0}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
              </div>
            </div>
            {MEASUREMENT_GROUPS.map((group) => (
              <div key={group.id} className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {fieldsInGroup(group.id).map((field) => (
                    <div
                      key={field.name}
                      onMouseEnter={() => setHovered(field.name)}
                      onMouseLeave={() =>
                        setHovered((current) =>
                          current === field.name ? null : current,
                        )
                      }
                      onFocusCapture={() => setFocused(field.name)}
                      onBlurCapture={() =>
                        setFocused((current) =>
                          current === field.name ? null : current,
                        )
                      }
                    >
                      <FieldInput form={form} base={base} field={field} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <aside className="order-1 h-fit rounded-xl border border-border/60 bg-card p-3 @2xl:order-2 @2xl:sticky @2xl:top-4">
            <form.Subscribe
              selector={(state: any) => readAt(state.values, base)}
            >
              {(values: MeasurementValues | undefined) => (
                <ThobDiagram
                  activeField={activeField}
                  values={values}
                  onSelectField={(name) =>
                    document.getElementById(`${base}.${name}`)?.focus()
                  }
                />
              )}
            </form.Subscribe>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              Hover or focus a field to see where it is measured.
            </p>
          </aside>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Saving always records these as a new measurement snapshot dated today.
      </p>
    </div>
  )
}
