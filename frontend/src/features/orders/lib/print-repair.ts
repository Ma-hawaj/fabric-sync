import { apiClient } from '@/lib/api'
import { printHtmlDocument } from '@/lib/print-document'

/**
 * Prints a repair slip, by way of the document the backend renders for it.
 * Server-side like the invoice/order documents (see backend
 * `orders/repair_document.rs`), so the request goes through `apiClient` and
 * carries an Authorization header.
 */
export async function printRepairDocument(
  orderId: string,
  repairId: string,
): Promise<void> {
  const { data: html } = await apiClient.get<string>(
    `/orders/${orderId}/repairs/${repairId}/document`,
    { responseType: 'text' },
  )

  await printHtmlDocument(html, 'repair')
}
