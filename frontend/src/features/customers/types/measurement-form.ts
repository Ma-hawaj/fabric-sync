// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

// What a measurement snapshot describes: the customer's body as measured, an
// existing thobe copied stitch-for-stitch, or a sample kept on file.
export const MEASUREMENT_TYPES = ['body', 'thobe', 'sample'] as const
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number]

// How the garment should be cut: loose, fitted, or somewhere in between.
export const MEASUREMENT_FITS = ['loose', 'fit', 'medium'] as const
export type MeasurementFit = (typeof MEASUREMENT_FITS)[number]

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

  lengthFl: NumberInput
  lengthBl: NumberInput
  chest: NumberInput
  waist: NumberInput
  hips: NumberInput
  shoulder: NumberInput
  shoulderDown: NumberInput
  sleeveLength: NumberInput
  neck: NumberInput
  openHand: NumberInput
  openHandFolding: NumberInput
  chestUp: NumberInput
  cuffWidth: NumberInput
  cuffling: NumberInput
  neckWidth: NumberInput
  armHole: NumberInput
  foWidth: NumberInput
  fo: NumberInput
  sleeveHalf: NumberInput
  openFold: NumberInput
  bottom: NumberInput
  bottomFolding: NumberInput
  fullBody: NumberInput
  frontPocketLength: NumberInput
  frontPocketLengthByWidth: string
  sidePocketLength: NumberInput
  sidePocketLengthByWidth: string
  mobilePocketLengthByWidth: string
}

export function createEmptyMeasurement(): MeasurementDraft {
  return {
    loadedFromId: null,
    date: new Date().toISOString().slice(0, 10),
    type: '',
    fit: '',
    lengthFl: '',
    lengthBl: '',
    chest: '',
    waist: '',
    hips: '',
    shoulder: '',
    shoulderDown: '',
    sleeveLength: '',
    neck: '',
    openHand: '',
    openHandFolding: '',
    chestUp: '',
    cuffWidth: '',
    cuffling: '',
    neckWidth: '',
    armHole: '',
    foWidth: '',
    fo: '',
    sleeveHalf: '',
    openFold: '',
    bottom: '',
    bottomFolding: '',
    fullBody: '',
    frontPocketLength: '',
    frontPocketLengthByWidth: '',
    sidePocketLength: '',
    sidePocketLengthByWidth: '',
    mobilePocketLengthByWidth: '',
  }
}
