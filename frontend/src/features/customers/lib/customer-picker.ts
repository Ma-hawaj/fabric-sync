import type { Customer } from '../types/customers'

export const CUSTOMER_SEARCH_FIELDS = [
  'name',
  'mobileNo',
  'customerCode',
] as const
export const CUSTOMER_SEARCH_PLACEHOLDER =
  'Search customer by ID, name or phone...'

export function customerOptionLabel(
  customer: Pick<Customer, 'customerNumber' | 'name' | 'mobileNo'>,
) {
  return `C-${customer.customerNumber} · ${customer.name} — ${customer.mobileNo}`
}
