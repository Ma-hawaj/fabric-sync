import { createEmptyMeasurement } from './measurement-form'
import type { MeasurementDraft } from './measurement-form'

export interface CustomerFormValues {
  name: string
  mobileNo: string
  addMeasurement: boolean
  measurement: MeasurementDraft
}

export function createEmptyCustomerForm(): CustomerFormValues {
  return {
    name: '',
    mobileNo: '',
    addMeasurement: false,
    measurement: createEmptyMeasurement(),
  }
}
