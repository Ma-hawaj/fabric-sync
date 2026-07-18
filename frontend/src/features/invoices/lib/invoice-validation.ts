import type {
  InvoiceCustomerDraft,
  InvoiceFormValues,
} from '../types/invoice-form'

function validateGuardian(
  customer: InvoiceCustomerDraft,
  customers: InvoiceCustomerDraft[],
  label: string,
): string | null {
  const { guardian } = customer
  switch (guardian.mode) {
    case 'unset':
      return `${label}: select a guardian for this child.`
    case 'existing':
      if (!guardian.existingCustomerId) {
        return `${label}: select a guardian for this child.`
      }
      return null
    case 'invoiceCustomer':
      if (
        !guardian.invoiceCustomerKey ||
        !customers.some((c) => c.key === guardian.invoiceCustomerKey)
      ) {
        return `${label}: the selected guardian was removed from this invoice — pick another.`
      }
      return null
    case 'new':
      if (!guardian.name.trim()) {
        return `${label}: enter the new guardian's name.`
      }
      if (!guardian.mobileNo.trim()) {
        return `${label}: enter the new guardian's phone number.`
      }
      return null
  }
}

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
      if (customer.customerType === 'child') {
        const guardianError = validateGuardian(customer, customers, label)
        if (guardianError) return guardianError
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
