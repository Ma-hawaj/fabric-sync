import { createContext, useContext } from 'react'

export const InvoiceVatRateContext = createContext<number | null>(null)

export function useInvoiceVatRate() {
  return useContext(InvoiceVatRateContext)
}
