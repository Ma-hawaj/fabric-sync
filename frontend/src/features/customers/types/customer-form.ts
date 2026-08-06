import { createEmptyMeasurement } from './measurement-form'
import type { MeasurementDraft } from './measurement-form'

export interface CustomerFormValues {
  name: string
  mobileNo: string
  marketingOptIn: boolean
  addMeasurement: boolean
  measurement: MeasurementDraft
}

export function createEmptyCustomerForm(): CustomerFormValues {
  return {
    name: '',
    mobileNo: '',
    marketingOptIn: false,
    addMeasurement: false,
    measurement: createEmptyMeasurement(),
  }
}
