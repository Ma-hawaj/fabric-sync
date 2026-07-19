import { z } from 'zod'
import type { MeasurementDraft } from '../types/measurement-form'

// Measurements have no validation rules — every field is optional free
// text/numbers — so there's nothing for zod to check. `z.custom` keeps the
// real MeasurementDraft type flowing through without enumerating all 24
// fields for no benefit.
const measurementDraftSchema = z.custom<MeasurementDraft>()

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a full name.'),
  mobileNo: z.string().trim().min(1, 'Enter a phone number.'),
  addMeasurement: z.boolean(),
  measurement: measurementDraftSchema,
})
