import { localDateString } from '@/lib/date'

// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

// What a measurement snapshot describes: the customer's body as measured, an
// existing thobe copied stitch-for-stitch, or a sample kept on file.
export const MEASUREMENT_TYPES = ['body', 'thobe', 'sample'] as const
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number]

// How the garment should be cut: loose, fitted, or somewhere in between.
export const MEASUREMENT_FITS = ['loose', 'fit', 'medium'] as const
export type MeasurementFit = (typeof MEASUREMENT_FITS)[number]

// Field names match the thobe diagram slots wherever the drawing has a slot:
// frontHeight/backHeight (lengths), neckSize, hip (singular), armhole
// (lowercase), bottomFold, frontPocketLength, sidePocket, cuffSize. The pocket L×W
// stays one text field by design — the diagram was fixed to a single slot
// rather than splitting the stored value.
export interface MeasurementDraft {
  // Id of the historical snapshot this was loaded from, if any. Editing
  // never overwrites it — saving always inserts a new dated measurement
  // record, whether loaded from history or started blank.
  loadedFromId: string | null
  date: string
  // Record-level choices rather than lengths. Blank means "not picked yet" —
  // the form requires both before saving (legacy snapshots predate them and
  // arrive blank, so the next edit picks them up).
  type: string
  fit: string

  frontHeight: NumberInput
  backHeight: NumberInput
  chest: NumberInput
  waist: NumberInput
  hip: NumberInput
  shoulder: NumberInput
  shoulderDown: NumberInput
  sleeveLength: NumberInput
  neckSize: NumberInput
  openHand: NumberInput
  chestUp: NumberInput
  cuffWidth: NumberInput
  cuffSize: NumberInput
  neckWidth: NumberInput
  armhole: NumberInput
  foWidth: NumberInput
  fo: NumberInput
  sleeveHalf: NumberInput
  openFold: NumberInput
  bottom: NumberInput
  bottomFold: NumberInput
  fullBody: NumberInput
  frontPocketLength: NumberInput
  frontPocketLengthByWidth: string
  sidePocket: NumberInput
  sidePocketLengthByWidth: string
  mobilePocketLengthByWidth: string
}

export function createEmptyMeasurement(): MeasurementDraft {
  return {
    loadedFromId: null,
    date: localDateString(),
    type: '',
    fit: '',
    frontHeight: '',
    backHeight: '',
    chest: '',
    waist: '',
    hip: '',
    shoulder: '',
    shoulderDown: '',
    sleeveLength: '',
    neckSize: '',
    openHand: '',
    chestUp: '',
    cuffWidth: '',
    cuffSize: '',
    neckWidth: '',
    armhole: '',
    foWidth: '',
    fo: '',
    sleeveHalf: '',
    openFold: '',
    bottom: '',
    bottomFold: '',
    fullBody: '',
    frontPocketLength: '',
    frontPocketLengthByWidth: '',
    sidePocket: '',
    sidePocketLengthByWidth: '',
    mobilePocketLengthByWidth: '',
  }
}
