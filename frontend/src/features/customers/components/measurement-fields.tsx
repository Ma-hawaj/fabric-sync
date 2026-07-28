import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NumberField, SelectField, TextField } from '@/components/form/fields'
import type { AnyFormApi } from '@/components/form/fields'
import { Label } from '@/components/ui/label'
import { ThobDiagram } from './thob-diagram'
import type { MeasurementValues } from './thob-diagram'
import {
  MEASUREMENT_FIELDS,
  MEASUREMENT_GROUPS,
  fieldsInGroup,
} from '../data/measurement-fields'
import type { MeasurementField } from '../data/measurement-fields'
import type { Measurement } from '../types/customers'
import type { MeasurementDraft } from '../types/measurement-form'
import { createEmptyMeasurement } from '../types/measurement-form'

export function snapshotLabel(
  snapshot: Measurement,
  idx: number,
  total: number,
) {
  const date = new Date(snapshot.date).toLocaleDateString()
  return idx === 0 ? `Current (${date})` : `Previous #${total - idx} (${date})`
}

export function measurementFromSnapshot(
  snapshot: Measurement | null,
): MeasurementDraft {
  // Start from a blank draft so an unset field stays '' rather than
  // undefined, then copy across whatever the snapshot actually recorded.
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
    return <NumberField form={form} name={name} label={field.label} unit="cm" />
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
  // focused field rather than clearing the sketch.
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
                <SelectContent>
                  {history.map((snapshot, idx) => (
                    <SelectItem key={snapshot.id} value={snapshot.id}>
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
          embedded in the (narrower) invoice form, where the sketch has to
          drop below the inputs rather than squeeze in beside them. */}
      <div className="@container">
        <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="order-2 space-y-5 @3xl:order-1">
            {MEASUREMENT_GROUPS.map((group) => (
              <div key={group.id} className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h4>
                <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-3">
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

          <aside className="order-1 h-fit rounded-xl border border-border/60 bg-card p-3 @3xl:order-2 @3xl:sticky @3xl:top-4">
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
