import { z } from 'zod'
import type { MeasurementDraft } from '../types/invoice-form'

// A blank string means "not entered yet" — mirrors NumberInput in
// types/invoice-form.ts.
const numberInputSchema = z.union([z.number(), z.literal('')])

// Measurements have no validation rules — every field is optional free
// text/numbers — so there's nothing for zod to check. `z.custom` keeps the
// real MeasurementDraft type flowing through without enumerating all 24
// fields for no benefit.
const measurementDraftSchema = z.custom<MeasurementDraft>()

const guardianDraftSchema = z.object({
  mode: z.enum(['unset', 'existing', 'invoiceCustomer', 'new']),
  existingCustomerId: z.string(),
  invoiceCustomerKey: z.string(),
  name: z.string(),
  nameArabic: z.string(),
  mobileNo: z.string(),
})

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
  })
  .superRefine((order, ctx) => {
    if (!order.materialId || order.materialAmount === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a material and quantity.',
        path: ['materialId'],
      })
    }
  })

const customerDraftSchema = z
  .object({
    key: z.string(),
    mode: z.enum(['existing', 'new']),
    existingCustomerId: z.string(),
    customerType: z.enum(['adult', 'child']),
    name: z.string(),
    nameArabic: z.string(),
    mobileNo: z.string(),
    guardian: guardianDraftSchema,
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

    if (customer.customerType === 'adult') {
      if (!customer.mobileNo.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a phone number, or mark them as a child.',
          path: ['mobileNo'],
        })
      }
      return
    }

    const guardian = customer.guardian
    if (guardian.mode === 'unset') {
      ctx.addIssue({
        code: 'custom',
        message: 'Select a guardian for this child.',
        path: ['guardian'],
      })
    } else if (guardian.mode === 'existing' && !guardian.existingCustomerId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select a guardian for this child.',
        path: ['guardian'],
      })
    } else if (
      guardian.mode === 'invoiceCustomer' &&
      !guardian.invoiceCustomerKey
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select a guardian for this child.',
        path: ['guardian'],
      })
    } else if (guardian.mode === 'new') {
      if (!guardian.name.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: "Enter the new guardian's name.",
          path: ['guardian', 'name'],
        })
      }
      if (!guardian.mobileNo.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: "Enter the new guardian's phone number.",
          path: ['guardian', 'mobileNo'],
        })
      }
    }
  })

const customersArraySchema = z
  .array(customerDraftSchema)
  .min(1, 'Add at least one customer.')
  .superRefine((customers, ctx) => {
    customers.forEach((customer, index) => {
      if (
        customer.mode === 'new' &&
        customer.customerType === 'child' &&
        customer.guardian.mode === 'invoiceCustomer'
      ) {
        const stillOnInvoice = customers.some(
          (c) => c.key === customer.guardian.invoiceCustomerKey,
        )
        if (!stillOnInvoice) {
          ctx.addIssue({
            code: 'custom',
            message:
              'The selected guardian was removed from this invoice — pick another.',
            path: [index, 'guardian'],
          })
        }
      }
    })
  })

export const invoiceFormSchema = z.object({
  date: z.string(),
  receivingBranch: z.string(),
  discount: numberInputSchema,
  discountUnit: z.enum(['SAR', '%']),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
  amountPaid: numberInputSchema,
  customers: customersArraySchema,
})
