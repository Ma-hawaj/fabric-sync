import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { CustomerFormValues } from '../types/customer-form'
import type { Customer } from '../types/customers'
import type { MeasurementDraft } from '../types/measurement-form'

// Blank strings mean "not entered" in a MeasurementDraft; the backend wants
// those fields absent (null) rather than empty strings.
function blankToNull<T>(value: T | ''): T | null {
  return value === '' ? null : value
}

// Also used by the invoice form, which snapshots a measurement per customer.
export function measurementPayload(measurement: MeasurementDraft) {
  return {
    date: measurement.date,
    lengthFl: blankToNull(measurement.lengthFl),
    lengthBl: blankToNull(measurement.lengthBl),
    chest: blankToNull(measurement.chest),
    waist: blankToNull(measurement.waist),
    hips: blankToNull(measurement.hips),
    shoulder: blankToNull(measurement.shoulder),
    shoulderDown: blankToNull(measurement.shoulderDown),
    sleeveLength: blankToNull(measurement.sleeveLength),
    neck: blankToNull(measurement.neck),
    openHand: blankToNull(measurement.openHand),
    openHandFolding: blankToNull(measurement.openHandFolding),
    chestUp: blankToNull(measurement.chestUp),
    cuffWidth: blankToNull(measurement.cuffWidth),
    cuffling: blankToNull(measurement.cuffling),
    neckWidth: blankToNull(measurement.neckWidth),
    armHole: blankToNull(measurement.armHole),
    foWidth: blankToNull(measurement.foWidth),
    fo: blankToNull(measurement.fo),
    sleeveHalf: blankToNull(measurement.sleeveHalf),
    button: blankToNull(measurement.button),
    buttonFold: blankToNull(measurement.buttonFold),
    openFold: blankToNull(measurement.openFold),
    bottom: blankToNull(measurement.bottom),
    bottomFolding: blankToNull(measurement.bottomFolding),
    fullBody: blankToNull(measurement.fullBody),
    frontPocketLength: blankToNull(measurement.frontPocketLength),
    frontPocketLengthByWidth: blankToNull(measurement.frontPocketLengthByWidth),
    sidePocketLength: blankToNull(measurement.sidePocketLength),
    sidePocketLengthByWidth: blankToNull(measurement.sidePocketLengthByWidth),
    mobilePocketLengthByWidth: blankToNull(
      measurement.mobilePocketLengthByWidth,
    ),
  }
}

async function createCustomer(values: CustomerFormValues): Promise<Customer> {
  const { data } = await apiClient.post<Customer>('/customers', {
    name: values.name,
    mobileNo: values.mobileNo,
    measurement: values.addMeasurement
      ? measurementPayload(values.measurement)
      : null,
  })
  return data
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createCustomer,
    onSuccess: () => {
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}
