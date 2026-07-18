import type { Customer } from '@/features/customers/types/customers'
import type { InvoiceCustomerDraft } from '../types/invoice-form'

export interface GuardianCandidate {
  value: string
  label: string
}

function invoiceCustomerLabel(
  customer: InvoiceCustomerDraft,
  index: number,
  existingCustomers: Customer[],
): string {
  const position = `Customer ${index + 1}`
  if (customer.mode === 'existing') {
    const found = existingCustomers.find(
      (c) => c.id === customer.existingCustomerId,
    )
    return found ? `${found.name} — ${found.mobileNo} (${position})` : position
  }
  const name = customer.name.trim() || position
  return customer.mobileNo
    ? `${name} — ${customer.mobileNo} (${position})`
    : name
}

/** Existing customers (from the system) who could be a guardian. */
export function existingGuardianCandidates(
  existingCustomers: Customer[],
): GuardianCandidate[] {
  return existingCustomers
    .filter((c) => c.mobileNo)
    .map((c) => ({
      value: `existing:${c.id}`,
      label: `${c.name} — ${c.mobileNo}`,
    }))
}

/**
 * Other adult customer blocks already on this same invoice — new or
 * existing — excluding the child's own block. These aren't saved yet, so
 * they're referenced by their client-side draft key, not a real customer id.
 */
export function invoiceGuardianCandidates(
  customers: InvoiceCustomerDraft[],
  currentIndex: number,
  existingCustomers: Customer[],
): GuardianCandidate[] {
  return customers
    .map((customer, index) => ({ customer, index }))
    .filter(({ customer, index }) => {
      if (index === currentIndex) return false
      if (customer.mode === 'existing') {
        const found = existingCustomers.find(
          (c) => c.id === customer.existingCustomerId,
        )
        return Boolean(found?.mobileNo)
      }
      return customer.customerType === 'adult'
    })
    .map(({ customer, index }) => ({
      value: `invoice:${customer.key}`,
      label: invoiceCustomerLabel(customer, index, existingCustomers),
    }))
}
