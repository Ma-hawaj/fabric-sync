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
    type: blankToNull(measurement.type),
    fit: blankToNull(measurement.fit),
    frontHeight: blankToNull(measurement.frontHeight),
    backHeight: blankToNull(measurement.backHeight),
    chest: blankToNull(measurement.chest),
    waist: blankToNull(measurement.waist),
    hip: blankToNull(measurement.hip),
    shoulder: blankToNull(measurement.shoulder),
    shoulderDown: blankToNull(measurement.shoulderDown),
    sleeveLength: blankToNull(measurement.sleeveLength),
    neckSize: blankToNull(measurement.neckSize),
    openHand: blankToNull(measurement.openHand),
    chestUp: blankToNull(measurement.chestUp),
    cuffWidth: blankToNull(measurement.cuffWidth),
    cuffSize: blankToNull(measurement.cuffSize),
    neckWidth: blankToNull(measurement.neckWidth),
    armhole: blankToNull(measurement.armhole),
    foWidth: blankToNull(measurement.foWidth),
    fo: blankToNull(measurement.fo),
    sleeveHalf: blankToNull(measurement.sleeveHalf),
    openFold: blankToNull(measurement.openFold),
    bottom: blankToNull(measurement.bottom),
    bottomFold: blankToNull(measurement.bottomFold),
    fullBody: blankToNull(measurement.fullBody),
    frontPocketLength: blankToNull(measurement.frontPocketLength),
    frontPocketLengthByWidth: blankToNull(measurement.frontPocketLengthByWidth),
    sidePocket: blankToNull(measurement.sidePocket),
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
