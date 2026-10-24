import { createEmptyMeasurement } from './measurement-form'
import type { MeasurementDraft } from './measurement-form'
import type { Customer } from './customers'

export interface CustomerFormValues {
  name: string
  mobileNo: string
  whatsappNotificationsEnabled: boolean
  address: string
  addMeasurement: boolean
  measurement: MeasurementDraft
}

export function createEmptyCustomerForm(): CustomerFormValues {
  return {
    name: '',
    mobileNo: '',
    whatsappNotificationsEnabled: true,
    address: '',
    addMeasurement: false,
    measurement: createEmptyMeasurement(),
  }
}

// Measurements are never edited here — they grow through new visits — so the
// edit form starts with a blank draft and hides the measurement section.
export function customerToFormValues(customer: Customer): CustomerFormValues {
  return {
    name: customer.name,
    mobileNo: customer.mobileNo,
    whatsappNotificationsEnabled: customer.whatsappNotificationsEnabled ?? true,
    address: customer.address ?? '',
    addMeasurement: false,
    measurement: createEmptyMeasurement(),
  }
}
