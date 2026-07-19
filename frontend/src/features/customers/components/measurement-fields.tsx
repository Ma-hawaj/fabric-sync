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
import type { Measurement } from '../types/customers'
import type { MeasurementDraft } from '../types/measurement-form'

const NUMBER_FIELDS: { name: keyof MeasurementDraft; label: string }[] = [
  { name: 'lengthFl', label: 'Length (Front)' },
  { name: 'lengthBl', label: 'Length (Back)' },
  { name: 'chest', label: 'Chest' },
  { name: 'chestUp', label: 'Chest (Upper)' },
  { name: 'waist', label: 'Waist' },
  { name: 'hips', label: 'Hips' },
  { name: 'shoulder', label: 'Shoulder' },
  { name: 'sleeveLength', label: 'Sleeve Length' },
  { name: 'neck', label: 'Neck' },
  { name: 'neckWidth', label: 'Neck Width' },
  { name: 'openHand', label: 'Open Hand' },
  { name: 'cuffWidth', label: 'Cuff Width' },
  { name: 'aramHole', label: 'Armhole' },
  { name: 'foWidth', label: 'Fo Width' },
  { name: 'frantPocketLength', label: 'Front Pocket Length' },
]

const SELECT_FIELDS: {
  name: keyof MeasurementDraft
  label: string
  options: readonly string[]
}[] = [
  {
    name: 'cuffling',
    label: 'Cuffling',
    options: ['Button', 'No Button', 'Cufflink'],
  },
  {
    name: 'fullBody',
    label: 'Full Body Measurement',
    options: ['Yes', 'No'],
  },
  { name: 'openFold', label: 'Open / Fold', options: ['Open', 'Fold'] },
  {
    name: 'sleeveHaffButton',
    label: 'Sleeve Half Button',
    options: ['Yes', 'No'],
  },
  { name: 'buttonFold', label: 'Button Fold', options: ['Yes', 'No'] },
  { name: 'fo', label: 'Fo', options: ['Yes', 'No'] },
  {
    name: 'sidePocket',
    label: 'Side Pocket',
    options: ['None', 'Left', 'Right', 'Both'],
  },
]

const TEXT_FIELDS: { name: keyof MeasurementDraft; label: string }[] = [
  { name: 'farntPocketLengthByWidth', label: 'Front Pocket L×W' },
  { name: 'mobilePocketLengthByWidth', label: 'Mobile Pocket L×W' },
]

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
  return {
    loadedFromId: snapshot?.id ?? null,
    // Saving always creates a new record, dated today, regardless of which
    // historical snapshot it started from.
    date: new Date().toISOString().slice(0, 10),
    lengthFl: snapshot?.lengthFl ?? '',
    lengthBl: snapshot?.lengthBl ?? '',
    chest: snapshot?.chest ?? '',
    waist: snapshot?.waist ?? '',
    hips: snapshot?.hips ?? '',
    shoulder: snapshot?.shoulder ?? '',
    sleeveLength: snapshot?.sleeveLength ?? '',
    neck: snapshot?.neck ?? '',
    openHand: snapshot?.openHand ?? '',
    cuffling: snapshot?.cuffling ?? '',
    fullBody: snapshot?.fullBody ?? '',
    chestUp: snapshot?.chestUp ?? '',
    openFold: snapshot?.openFold ?? '',
    cuffWidth: snapshot?.cuffWidth ?? '',
    neckWidth: snapshot?.neckWidth ?? '',
    aramHole: snapshot?.aramHole ?? '',
    sleeveHaffButton: snapshot?.sleeveHaffButton ?? '',
    buttonFold: snapshot?.buttonFold ?? '',
    fo: snapshot?.fo ?? '',
    foWidth: snapshot?.foWidth ?? '',
    frantPocketLength: snapshot?.frantPocketLength ?? '',
    farntPocketLengthByWidth: snapshot?.farntPocketLengthByWidth ?? '',
    sidePocket: snapshot?.sidePocket ?? '',
    mobilePocketLengthByWidth: snapshot?.mobilePocketLengthByWidth ?? '',
  }
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {NUMBER_FIELDS.map(({ name, label }) => (
          <NumberField
            key={name}
            form={form}
            name={`${base}.${name}`}
            label={label}
            unit="cm"
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SELECT_FIELDS.map(({ name, label, options }) => (
          <SelectField
            key={name}
            form={form}
            name={`${base}.${name}`}
            label={label}
            options={options}
          />
        ))}
        {TEXT_FIELDS.map(({ name, label }) => (
          <TextField
            key={name}
            form={form}
            name={`${base}.${name}`}
            label={label}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Saving always records these as a new measurement snapshot dated today.
      </p>
    </div>
  )
}
