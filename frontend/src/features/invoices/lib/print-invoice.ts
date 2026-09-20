import { apiClient } from '@/lib/api'
import { printHtmlDocument } from '@/lib/print-document'

/**
 * Prints an invoice, by way of the document the backend renders for it. The
 * rendering happens server-side (see backend `invoices/document.rs`), so the
 * request goes through `apiClient` and carries an Authorization header.
 */
export async function printInvoiceDocument(invoiceId: string): Promise<void> {
  const { data: html } = await apiClient.get<string>(
    `/invoices/${invoiceId}/document`,
    { responseType: 'text' },
  )

  await printHtmlDocument(html, 'invoice')
}
