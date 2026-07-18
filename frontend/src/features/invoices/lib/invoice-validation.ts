import type { InvoiceFormValues } from '../types/invoice-form'

export function validateCustomers(
  customers: InvoiceFormValues['customers'],
): string | null {
  for (const [idx, customer] of customers.entries()) {
    const label = `Customer ${idx + 1}`
    if (customer.mode === 'existing') {
      if (!customer.existingCustomerId) {
        return `${label}: pick an existing customer or switch to "+ New Customer".`
      }
    } else {
      if (!customer.name.trim()) return `${label}: enter a full name.`
      if (customer.customerType === 'adult' && !customer.mobileNo.trim()) {
        return `${label}: enter a phone number, or mark them as a child.`
      }
      if (customer.customerType === 'child' && !customer.guardianId) {
        return `${label}: select a guardian for this child.`
      }
    }
    for (const [orderIdx, order] of customer.orders.entries()) {
      if (!order.materialId || order.materialAmount === '') {
        return `${label}, Order ${orderIdx + 1}: pick a material and quantity.`
      }
    }
  }
  return null
}
