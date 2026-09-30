import { apiClient } from '@/lib/api'
import { printPdfDocument } from '@/lib/print-document'

/**
 * Prints an order, by way of the PDF the backend renders for it. The
 * rendering happens server-side (see backend `orders/document.rs`), so the
 * request goes through `apiClient` and carries an Authorization header.
 */
export async function printOrderDocument(orderId: string): Promise<void> {
  const { data: pdf } = await apiClient.get<Blob>(
    `/orders/${orderId}/document`,
    {
      responseType: 'blob',
    },
  )

  await printPdfDocument(pdf, 'order')
}
