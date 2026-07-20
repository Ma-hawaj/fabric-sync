import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import {
  ApiError,
  measurementPayload,
} from '@/features/customers/hooks/use-create-customer'
import type {
  InvoiceCustomerDraft,
  InvoiceFormValues,
  InvoiceOrderDraft,
  NumberInput,
} from '../types/invoice-form'

export interface CreatedInvoice {
  id: string
  totalPrice: number
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

function invoicePayload(values: InvoiceFormValues) {
  return {
    date: values.date,
    branchId: values.receivingBranch || null,
    discount: numberOrZero(values.discount),
    discountUnit: values.discountUnit,
    paymentStatus: values.paymentStatus,
    amountPaid: numberOrZero(values.amountPaid),
    paymentType: values.paymentType || null,
    customers: values.customers.map(customerPayload),
  }
}

async function createInvoice(
  values: InvoiceFormValues,
): Promise<CreatedInvoice> {
  const response = await fetch(`${apiBaseUrl}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(invoicePayload(values)),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to create invoice (${response.status})`,
      response.status,
    )
  }
  return response.json()
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
    },
  })
}
