import { z } from 'zod'
import type { MeasurementDraft } from '../types/measurement-form'
import { MEASUREMENT_FITS, MEASUREMENT_TYPES } from '../types/measurement-form'

// Numeric and text measurement fields have no validation rules — every one
// is optional free text/numbers — so there's nothing for zod to check there
// and `z.custom` keeps the real MeasurementDraft type flowing through without
// enumerating them. The record-level type/fit choices are required instead,
// checked in the superRefine below.
const measurementDraftSchema = z.custom<MeasurementDraft>()

const MEASUREMENT_TYPE_VALUES = MEASUREMENT_TYPES as readonly string[]
const MEASUREMENT_FIT_VALUES = MEASUREMENT_FITS as readonly string[]

export const customerFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a full name.'),
    mobileNo: z.string().trim().min(1, 'Enter a phone number.'),
    whatsappNotificationsEnabled: z.boolean(),
    address: z.string(),
    addMeasurement: z.boolean(),
    measurement: measurementDraftSchema,
  })
  .superRefine((value, ctx) => {
    // Type and fit describe the record itself, so they are the only
    // measurement fields the form requires — legacy snapshots predate them
    // and arrive blank, to be picked on the next save.
    if (!value.addMeasurement) return
    if (!MEASUREMENT_TYPE_VALUES.includes(value.measurement.type)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a measurement type.',
        path: ['measurement', 'type'],
      })
    }
    if (!MEASUREMENT_FIT_VALUES.includes(value.measurement.fit)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a fit.',
        path: ['measurement', 'fit'],
      })
    }
  })
