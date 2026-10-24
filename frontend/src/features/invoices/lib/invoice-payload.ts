import { measurementPayload } from '@/features/customers/hooks/use-create-customer'
import type {
  GiftCardRedemptionDraft,
  InvoiceCustomerDraft,
  InvoiceFormValues,
  InvoiceGiftCardDraft,
  InvoiceOrderDraft,
  InvoiceProductDraft,
  NumberInput,
} from '../types/invoice-form'

export interface CreatedInvoice {
  id: string
  totalPrice: number
  giftCardRedeemed: number
  giftCards: Array<{ id: string; code: string }>
}

function numberOrZero(value: NumberInput): number {
  return value === '' ? 0 : value
}

// Segmented options left unpicked are blank strings; the backend stores those
// as null.
function blankToNull(value: string): string | null {
  return value === '' ? null : value
}

function orderPayload(order: InvoiceOrderDraft) {
  return {
    materialSource: order.materialSource,
    materialId: order.materialSource === 'shop' ? order.materialId : null,
    customerMaterialDescription:
      order.materialSource === 'customer'
        ? order.customerMaterialDescription.trim()
        : null,
    materialAmount: numberOrZero(order.materialAmount),
    productionLocationId: order.productionLocationId,
    isUrgent: order.isUrgent,
    thobeType: blankToNull(order.thobeType),
    fPocket: blankToNull(order.fPocket),
    sPocket: blankToNull(order.sPocket),
    collar: blankToNull(order.collar),
    sleeve: blankToNull(order.sleeve),
    patti: blankToNull(order.patti),
    emd: blankToNull(order.emd),
    moreDetails: blankToNull(order.moreDetails),
  }
}

function customerPayload(customer: InvoiceCustomerDraft) {
  return {
    existingCustomerId:
      customer.mode === 'existing' ? customer.existingCustomerId : null,
    newCustomer:
      customer.mode === 'new'
        ? {
            name: customer.name.trim(),
            mobileNo: customer.mobileNo.trim(),
            address: customer.address.trim(),
          }
        : null,
    measurement: measurementPayload(customer.measurement),
    orders: customer.orders.map(orderPayload),
  }
}

// One "sold from" location on the form is stamped onto every product line,
// since the backend records it per line for the stock it came off.
function productPayload(line: InvoiceProductDraft, branchId: string) {
  return {
    productId: line.productId,
    quantity: numberOrZero(line.quantity),
    unitPrice: numberOrZero(line.unitPrice),
    branchId,
  }
}

function giftCardPayload(line: InvoiceGiftCardDraft) {
  return {
    code: line.code,
    amount: numberOrZero(line.amount),
    boughtFor: blankToNull(line.boughtFor.trim()),
    recipientPhone: line.recipientPhone,
    expiresOn: blankToNull(line.expiresOn),
  }
}

function redemptionPayload(redemption: GiftCardRedemptionDraft) {
  return {
    code: redemption.code,
    amount: numberOrZero(redemption.amount),
  }
}

// Shared by create and update: an edit sends a fresh copy of the same input,
// and the backend rebuilds the invoice from it.
export function invoicePayload(values: InvoiceFormValues) {
  return {
    targetDate: values.targetDate || null,
    collectionMethod: values.collectionMethod,
    branchId: values.receivingBranch || null,
    discount: numberOrZero(values.discount),
    discountUnit: values.discountUnit,
    // Untouched blank rows never reach the server — every payment sent has a
    // positive amount and a named method (the schema enforces it).
    payments: values.payments
      .filter((payment) => payment.amount !== '' && payment.amount > 0)
      .map((payment) => ({
        amount: numberOrZero(payment.amount),
        paymentType: payment.paymentType || null,
      })),
    // Only meaningful for a sale with no orders to find a customer through;
    // it is left blank otherwise.
    customerId: values.customerId || null,
    customers: values.customers.map(customerPayload),
    products: values.products.map((line) =>
      productPayload(line, values.productBranch),
    ),
    giftCards: values.giftCards.map(giftCardPayload),
    giftCardRedemptions: values.redemptions.map(redemptionPayload),
  }
}
