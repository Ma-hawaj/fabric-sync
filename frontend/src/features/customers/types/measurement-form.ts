// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

export interface MeasurementDraft {
  // Id of the historical snapshot this was loaded from, if any. Editing
  // never overwrites it — saving always inserts a new dated measurement
  // record, whether loaded from history or started blank.
  loadedFromId: string | null
  date: string

  lengthFl: NumberInput
  lengthBl: NumberInput
  chest: NumberInput
  waist: NumberInput
  hips: NumberInput
  shoulder: NumberInput
  sleeveLength: NumberInput
  neck: NumberInput
  openHand: NumberInput
  cuffling: string

  fullBody: string
  chestUp: NumberInput
  openFold: string
  cuffWidth: NumberInput
  neckWidth: NumberInput
  aramHole: NumberInput
  sleeveHaffButton: string
  buttonFold: string
  fo: string
  foWidth: NumberInput
  frantPocketLength: NumberInput
  farntPocketLengthByWidth: string
  sidePocket: string
  mobilePocketLengthByWidth: string
}

export function createEmptyMeasurement(): MeasurementDraft {
  return {
    loadedFromId: null,
    date: new Date().toISOString().slice(0, 10),
    lengthFl: '',
    lengthBl: '',
    chest: '',
    waist: '',
    hips: '',
    shoulder: '',
    sleeveLength: '',
    neck: '',
    openHand: '',
    cuffling: '',
    fullBody: '',
    chestUp: '',
    openFold: '',
    cuffWidth: '',
    neckWidth: '',
    aramHole: '',
    sleeveHaffButton: '',
    buttonFold: '',
    fo: '',
    foWidth: '',
    frantPocketLength: '',
    farntPocketLengthByWidth: '',
    sidePocket: '',
    mobilePocketLengthByWidth: '',
  }
}
