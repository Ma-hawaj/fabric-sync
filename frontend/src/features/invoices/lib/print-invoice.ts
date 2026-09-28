import { apiClient } from '@/lib/api'
import { printPdfDocument } from '@/lib/print-document'

/**
 * Prints an invoice, by way of the PDF the backend renders for it. The
 * rendering happens server-side (see backend `invoices/document.rs`), so the
 * request goes through `apiClient` and carries an Authorization header.
 */
export async function printInvoiceDocument(invoiceId: string): Promise<void> {
  const { data: pdf } = await apiClient.get<Blob>(
    `/invoices/${invoiceId}/document`,
    { responseType: 'blob' },
  )

  await printPdfDocument(pdf, 'invoice')
}
