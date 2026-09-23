import { apiClient } from '@/lib/api'
import { printHtmlDocument } from '@/lib/print-document'

/**
 * Prints a backend-rendered invoice document by way of the HTML the backend
 * renders for it (server-side, see backend `invoices/document.rs`), carrying
 * an Authorization header through `apiClient`.
 */
async function printDocument(path: string, title: string): Promise<void> {
  const { data: html } = await apiClient.get<string>(path, {
    responseType: 'text',
  })

  await printHtmlDocument(html, title)
}

/** The printable invoice (GET /invoices/:id/document). */
export function printInvoiceDocument(invoiceId: string): Promise<void> {
  return printDocument(`/invoices/${invoiceId}/document`, 'invoice')
}

/** The ready-for-collection card (GET /invoices/:id/ready-card). */
export function printReadyCardDocument(invoiceId: string): Promise<void> {
  return printDocument(`/invoices/${invoiceId}/ready-card`, 'ready-card')
}
