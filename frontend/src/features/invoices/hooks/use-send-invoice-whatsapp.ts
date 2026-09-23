import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

export interface SendInvoiceWhatsAppInput {
  invoiceId: string
  /** Digits only, full international number (see `normalizePhoneNumber`). */
  to: string
  /** The invoice document captured to a PNG in the browser. */
  png: Blob
}

/**
 * Posts the captured invoice image to the backend, which sends it through the
 * WhatsApp Business Cloud API to the customer's number. The image has to be
 * captured client-side (`captureInvoiceImagePng`) — a browser rasterizes the
 * invoice HTML — so the server only ever sees the finished PNG.
 */
export function useSendInvoiceWhatsApp() {
  return useMutation({
    mutationFn: async ({
      invoiceId,
      to,
      png,
    }: SendInvoiceWhatsAppInput): Promise<{ messageId: string }> => {
      const { data } = await apiClient.post<{ messageId: string }>(
        `/whatsapp/invoices/${invoiceId}/messages`,
        {
          to,
          mediaBase64: await blobToBase64(png),
          mimeType: png.type || 'image/png',
        },
      )
      return data
    },
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // readAsDataURL yields `data:image/png;base64,<payload>` — the payload
      // after the comma is what the backend's base64 decoder expects.
      const dataUrl = reader.result as string
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
