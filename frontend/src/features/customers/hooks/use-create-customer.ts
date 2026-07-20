import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { CustomerFormValues } from '../types/customer-form'
import type { Customer } from '../types/customers'
import type { MeasurementDraft } from '../types/measurement-form'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

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
    sleeveLength: blankToNull(measurement.sleeveLength),
    neck: blankToNull(measurement.neck),
    openHand: blankToNull(measurement.openHand),
    cuffling: blankToNull(measurement.cuffling),
    fullBody: blankToNull(measurement.fullBody),
    chestUp: blankToNull(measurement.chestUp),
    openFold: blankToNull(measurement.openFold),
    cuffWidth: blankToNull(measurement.cuffWidth),
    neckWidth: blankToNull(measurement.neckWidth),
    aramHole: blankToNull(measurement.aramHole),
    sleeveHaffButton: blankToNull(measurement.sleeveHaffButton),
    buttonFold: blankToNull(measurement.buttonFold),
    fo: blankToNull(measurement.fo),
    foWidth: blankToNull(measurement.foWidth),
    frantPocketLength: blankToNull(measurement.frantPocketLength),
    farntPocketLengthByWidth: blankToNull(measurement.farntPocketLengthByWidth),
    sidePocket: blankToNull(measurement.sidePocket),
    mobilePocketLengthByWidth: blankToNull(
      measurement.mobilePocketLengthByWidth,
    ),
  }
}

async function createCustomer(values: CustomerFormValues): Promise<Customer> {
  const response = await fetch(`${apiBaseUrl}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: values.name,
      mobileNo: values.mobileNo,
      measurement: values.addMeasurement
        ? measurementPayload(values.measurement)
        : null,
    }),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to create customer (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      queryClient.setQueryData<Customer[]>(['customers'], (customers = []) => [
        ...customers,
        customer,
      ])
    },
  })
}
