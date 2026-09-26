import { z } from 'zod'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'
import {
  computeGiftCardLineTotal,
  computeInvoiceTotals,
  computeOrderLineTotal,
  computeProductLineTotal,
  computeRedemptionTotal,
} from './invoice-pricing'

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
    productionLocationId: z.string(),
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
    // Material stock is held per location, and comes off automatically when
    // the invoice is saved, so each order has to name one.
    if (!order.productionLocationId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick where this order is made.',
        path: ['productionLocationId'],
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

// No `.min(1)` any more: an invoice may consist entirely of products or gift
// cards. The "at least one line" rule moved to the top-level superRefine.
const customersArraySchema = z.array(customerDraftSchema)

const productLineDraftSchema = z
  .object({
    key: z.string(),
    productId: z.string(),
    quantity: numberInputSchema,
    unitPrice: numberInputSchema,
  })
  .superRefine((line, ctx) => {
    if (!line.productId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a product.',
        path: ['productId'],
      })
    }
    if (line.quantity === '' || line.quantity <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a quantity greater than 0.',
        path: ['quantity'],
      })
    }
    if (line.unitPrice === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a unit price.',
        path: ['unitPrice'],
      })
    }
  })

const giftCardLineDraftSchema = z
  .object({
    key: z.string(),
    code: z.string(),
    amount: numberInputSchema,
    expiresOn: z.string(),
  })
  .superRefine((line, ctx) => {
    if (!line.code.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a gift card code.',
        path: ['code'],
      })
    }
    if (line.amount === '' || line.amount <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter an amount greater than 0.',
        path: ['amount'],
      })
    }
  })

const redemptionDraftSchema = z
  .object({
    key: z.string(),
    code: z.string(),
    amount: numberInputSchema,
  })
  .superRefine((redemption, ctx) => {
    if (!redemption.code.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a gift card.',
        path: ['code'],
      })
    }
    if (redemption.amount === '' || redemption.amount <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter an amount greater than 0.',
        path: ['amount'],
      })
    }
  })

// One payment taken up front with the invoice. The amount has to be positive
// and the method named — a row with neither is an untouched blank the form
// tolerates until it is filled or removed.
const paymentDraftSchema = z
  .object({
    key: z.string(),
    amount: numberInputSchema,
    paymentType: z.enum(['benefit', 'cash', 'card', '']),
  })
  .superRefine((payment, ctx) => {
    if (payment.amount === '' && !payment.paymentType) return
    if (payment.amount === '' || payment.amount <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter an amount greater than 0.',
        path: ['amount'],
      })
    }
    if (!payment.paymentType) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick how this payment was made.',
        path: ['paymentType'],
      })
    }
  })

export const invoiceFormSchema = z
  .object({
    date: z.string(),
    receivingBranch: z.string(),
    customerId: z.string(),
    productBranch: z.string(),
    discount: numberInputSchema,
    discountUnit: z.enum(['amount', 'percent']),
    payments: z.array(paymentDraftSchema),
    customers: customersArraySchema,
    products: z.array(productLineDraftSchema),
    giftCards: z.array(giftCardLineDraftSchema),
    redemptions: z.array(redemptionDraftSchema),
  })
  .superRefine((value, ctx) => {
    const hasOrders = value.customers.some(
      (customer) => customer.orders.length > 0,
    )
    if (!hasOrders && !value.products.length && !value.giftCards.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Add at least one order, product, or gift card.',
        path: ['customers'],
      })
    }

    // Product stock is held per location, so a sale has to name one.
    if (value.products.length && !value.productBranch) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick the location these products are sold from.',
        path: ['productBranch'],
      })
    }

    const seenCodes = new Set<string>()
    value.redemptions.forEach((redemption, index) => {
      const code = redemption.code.trim().toUpperCase()
      if (!code || !seenCodes.has(code)) {
        seenCodes.add(code)
        return
      }

      ctx.addIssue({
        code: 'custom',
        message: 'Each gift card can only be applied once.',
        path: ['redemptions', index, 'code'],
      })
    })

    // Up-front payments are capped at what the invoice charges — the same
    // rule the backend enforces. Recomputed here from the drafts with the
    // shared pricing math so the form and the server can't disagree.
    const orderTotal = value.customers.reduce(
      (sum, customer) =>
        sum +
        customer.orders.reduce(
          (s, order) => s + computeOrderLineTotal(order),
          0,
        ),
      0,
    )
    const totals = computeInvoiceTotals({
      orderTotal,
      productTotal: value.products.reduce(
        (sum, line) => sum + computeProductLineTotal(line),
        0,
      ),
      giftCardSales: value.giftCards.reduce(
        (sum, line) => sum + computeGiftCardLineTotal(line),
        0,
      ),
      discount: value.discount === '' ? 0 : value.discount,
      discountUnit: value.discountUnit,
      redeemed: value.redemptions.reduce(
        (sum, redemption) => sum + computeRedemptionTotal(redemption),
        0,
      ),
      paid: value.payments.reduce(
        (sum, payment) =>
          sum + (payment.amount === '' ? 0 : Math.max(payment.amount, 0)),
        0,
      ),
    })
    if (totals.paid - (totals.total - totals.redeemed) > 1e-9) {
      ctx.addIssue({
        code: 'custom',
        message: 'Payments cover more than the invoice total.',
        path: ['payments'],
      })
    }
  })
