import type { RowSelectionState } from '@tanstack/react-table'
import type { Customer } from '@/features/customers/types/customers'

export function optedInCustomers(customers: Customer[]): Customer[] {
  return customers.filter((customer) => customer.marketingOptIn)
}

// Pre-checks every opted-in customer by default; staff deselect individuals
// from there rather than building a selection from scratch.
export function defaultRecipientSelection(
  customers: Customer[],
): RowSelectionState {
  return Object.fromEntries(customers.map((customer) => [customer.id, true]))
}
