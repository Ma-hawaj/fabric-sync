import { apiClient } from '@/lib/api'
import { printHtmlDocument } from '@/lib/print-document'

/** Download the immutable server PDF also used by notification previews. */
export async function downloadInvoicePdf(invoiceId: string): Promise<void> {
  const { data: artifact } = await apiClient.post<{
    id: string
    filename: string
  }>(`/invoices/${invoiceId}/documents`)
  const { data: bytes } = await apiClient.get<Blob>(
    `/documents/${artifact.id}/content`,
    { responseType: 'blob' },
  )
  const url = URL.createObjectURL(bytes)
  const link = document.createElement('a')
  link.href = url
  link.download = artifact.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Allow the browser to consume the object URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

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
