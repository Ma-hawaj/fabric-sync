import type { MeasurementDraft } from '../types/measurement-form'

/** Every measurement a form can capture — the bookkeeping fields aside. */
export type MeasurementFieldName = Exclude<
  keyof MeasurementDraft,
  'loadedFromId' | 'date'
>

export type MeasurementInput =
  | { kind: 'number' }
  | { kind: 'text' }
  | { kind: 'select'; options: readonly string[] }

export type MeasurementGroupId = 'body' | 'pockets' | 'style'

export interface MeasurementField {
  name: MeasurementFieldName
  label: string
  group: MeasurementGroupId
  input: MeasurementInput
}

export const MEASUREMENT_UNIT = 'inch'

export const MEASUREMENT_GROUPS: {
  id: MeasurementGroupId
  title: string
}[] = [
  { id: 'body', title: 'Body Dimensions' },
  { id: 'pockets', title: 'Pockets' },
  { id: 'style', title: 'Style & Finishing' },
]

const NUMBER: MeasurementInput = { kind: 'number' }
const TEXT: MeasurementInput = { kind: 'text' }

// Field names match the thobe diagram slots (`thob-diagram.tsx`
// `THOBE_VALUE_SLOTS`) wherever the drawing has a slot for them: frontHeight,
// backHeight, neckSize, hip, armhole, bottomFold, frontPocketLength,
// sidePocket and cuffSize are the renamed keys, and the back shoulder slot
// reads the plain shoulder width. Fields with no slot on the drawing
// (sidePocketLengthByWidth, mobilePocketLengthByWidth) still render in the
// form and print in the measurement grid — table-only by design.
export const MEASUREMENT_FIELDS: MeasurementField[] = [
  { name: 'frontHeight', label: 'Front Height', group: 'body', input: NUMBER },
  { name: 'backHeight', label: 'Back Height', group: 'body', input: NUMBER },
  { name: 'shoulder', label: 'Shoulder', group: 'body', input: NUMBER },
  {
    name: 'shoulderDown',
    label: 'Shoulder Down',
    group: 'body',
    input: NUMBER,
  },
  { name: 'chest', label: 'Chest', group: 'body', input: NUMBER },
  { name: 'chestUp', label: 'Chest (Upper)', group: 'body', input: NUMBER },
  { name: 'waist', label: 'Waist', group: 'body', input: NUMBER },
  { name: 'hip', label: 'Hip', group: 'body', input: NUMBER },
  { name: 'bottom', label: 'Bottom', group: 'body', input: NUMBER },
  { name: 'bottomFold', label: 'Bottom Fold', group: 'body', input: NUMBER },
  { name: 'fullBody', label: 'Full Body', group: 'body', input: NUMBER },
  { name: 'neckSize', label: 'Neck Size', group: 'body', input: NUMBER },
  { name: 'neckWidth', label: 'Neck Width', group: 'body', input: NUMBER },
  { name: 'armhole', label: 'Armhole', group: 'body', input: NUMBER },
  {
    name: 'sleeveLength',
    label: 'Sleeve Length',
    group: 'body',
    input: NUMBER,
  },
  { name: 'sleeveHalf', label: 'Sleeve Half', group: 'body', input: NUMBER },
  { name: 'openHand', label: 'Open Hand', group: 'body', input: NUMBER },
  { name: 'cuffWidth', label: 'Cuff Width', group: 'body', input: NUMBER },
  { name: 'cuffSize', label: 'Cuff Size', group: 'body', input: NUMBER },
  { name: 'openFold', label: 'Open Fold', group: 'body', input: NUMBER },

  {
    name: 'frontPocketLength',
    label: 'Front Pocket Length',
    group: 'pockets',
    input: NUMBER,
  },
  {
    name: 'frontPocketLengthByWidth',
    label: 'Pocket L×W',
    group: 'pockets',
    input: TEXT,
  },
  { name: 'sidePocket', label: 'Side Pocket', group: 'pockets', input: NUMBER },
  {
    name: 'sidePocketLengthByWidth',
    label: 'Side Pocket L×W',
    group: 'pockets',
    input: TEXT,
  },
  {
    name: 'mobilePocketLengthByWidth',
    label: 'Mobile Pocket L×W',
    group: 'pockets',
    input: TEXT,
  },

  { name: 'foWidth', label: 'Fo Width', group: 'style', input: NUMBER },
  { name: 'fo', label: 'Fo', group: 'style', input: NUMBER },
]

const FIELDS_BY_NAME = new Map(MEASUREMENT_FIELDS.map((f) => [f.name, f]))

export function measurementField(name: string): MeasurementField | undefined {
  return FIELDS_BY_NAME.get(name as MeasurementFieldName)
}

export function fieldsInGroup(group: MeasurementGroupId): MeasurementField[] {
  return MEASUREMENT_FIELDS.filter((field) => field.group === group)
}
