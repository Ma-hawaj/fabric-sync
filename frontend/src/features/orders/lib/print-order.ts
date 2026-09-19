import { apiClient } from '@/lib/api'
import { printHtmlDocument } from '@/lib/print-document'

/**
 * Prints an order, by way of the document the backend renders for it. The
 * rendering happens server-side (see backend `orders/document.rs`), so the
 * request goes through `apiClient` and carries an Authorization header.
 */
export async function printOrderDocument(orderId: string): Promise<void> {
  const { data: html } = await apiClient.get<string>(
    `/orders/${orderId}/document`,
    { responseType: 'text' },
  )

  await printHtmlDocument(html, 'order')
}
