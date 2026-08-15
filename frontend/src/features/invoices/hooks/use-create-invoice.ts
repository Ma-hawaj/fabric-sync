import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
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
    materialId: order.materialId,
    materialAmount: numberOrZero(order.materialAmount),
    price: numberOrZero(order.price),
    thobeType: blankToNull(order.thobeType),
    fPocket: blankToNull(order.fPocket),
    collar: blankToNull(order.collar),
    sleeve: blankToNull(order.sleeve),
    patti: blankToNull(order.patti),
    moreDetails: blankToNull(order.moreDetails),
  }
}

function customerPayload(customer: InvoiceCustomerDraft) {
  return {
    existingCustomerId:
      customer.mode === 'existing' ? customer.existingCustomerId : null,
    newCustomer:
      customer.mode === 'new'
        ? { name: customer.name, mobileNo: customer.mobileNo }
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
    expiresOn: blankToNull(line.expiresOn),
  }
}

function redemptionPayload(redemption: GiftCardRedemptionDraft) {
  return {
    code: redemption.code,
    amount: numberOrZero(redemption.amount),
  }
}

function invoicePayload(values: InvoiceFormValues) {
  return {
    date: values.date,
    branchId: values.receivingBranch || null,
    discount: numberOrZero(values.discount),
    discountUnit: values.discountUnit,
    paymentStatus: values.paymentStatus,
    amountPaid: numberOrZero(values.amountPaid),
    paymentType: values.paymentType || null,
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

async function createInvoice(
  values: InvoiceFormValues,
): Promise<CreatedInvoice> {
  const { data } = await apiClient.post<CreatedInvoice>(
    '/invoices',
    invoicePayload(values),
  )
  return data
}

export function useCreateInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createInvoice,
    onSuccess: () => {
      // Saving an invoice can create customers and always records new
      // measurement snapshots, so cached customers are stale now — as are
      // the invoice and order lists.
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      // A sale can draw down product stock, issue new cards, and spend the
      // balance on existing ones.
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
    },
  })
}
