import { z } from 'zod'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'

// A blank string means "not entered yet" — mirrors NumberInput in
// types/invoice-form.ts.
const numberInputSchema = z.union([z.number(), z.literal('')])

// Measurements have no validation rules — every field is optional free
// text/numbers — so there's nothing for zod to check. `z.custom` keeps the
// real MeasurementDraft type flowing through without enumerating all 24
// fields for no benefit.
const measurementDraftSchema = z.custom<MeasurementDraft>()

const orderDraftSchema = z
  .object({
    key: z.string(),
    thobeType: z.string(),
    fPocket: z.string(),
    collar: z.string(),
    sleeve: z.string(),
    patti: z.string(),
    moreDetails: z.string(),
    materialId: z.string(),
    materialAmount: numberInputSchema,
    price: numberInputSchema,
  })
  .superRefine((order, ctx) => {
    if (!order.materialId || order.materialAmount === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a material and quantity.',
        path: ['materialId'],
      })
    }
    if (order.price === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a price.',
        path: ['price'],
      })
    }
  })

const customerDraftSchema = z
  .object({
    key: z.string(),
    mode: z.enum(['existing', 'new']),
    existingCustomerId: z.string(),
    name: z.string(),
    mobileNo: z.string(),
    measurement: measurementDraftSchema,
    orders: z.array(orderDraftSchema).min(1, 'Add at least one order.'),
  })
  .superRefine((customer, ctx) => {
    if (customer.mode === 'existing') {
      if (!customer.existingCustomerId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Pick an existing customer or switch to "+ New Customer".',
          path: ['existingCustomerId'],
        })
      }
      return
    }

    if (!customer.name.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a full name.',
        path: ['name'],
      })
    }

    if (!customer.mobileNo.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a phone number.',
        path: ['mobileNo'],
      })
    }
  })

const customersArraySchema = z
  .array(customerDraftSchema)
  .min(1, 'Add at least one customer.')

export const invoiceFormSchema = z.object({
  date: z.string(),
  receivingBranch: z.string(),
  discount: numberInputSchema,
  discountUnit: z.enum(['amount', 'percent']),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
  amountPaid: numberInputSchema,
  customers: customersArraySchema,
})
