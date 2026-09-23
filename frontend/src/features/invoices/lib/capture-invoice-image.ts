import { toBlob } from 'html-to-image'
import { apiClient } from '@/lib/api'

// A4 at 96 DPI — the width the backend documents' screen render is sized for.
// Captured at 2x so the image stays legible through WhatsApp's thumbnailing.
const A4_WIDTH_PX = 794

/**
 * Rasterizes a backend-rendered invoice document into a PNG. The document is
 * self-contained — inline styles, inline SVG, `data:` images, an embedded QR —
 * so it renders inside an offscreen iframe it doesn't need to load anything
 * against, and the capture carries no cross-origin taint.
 */
async function captureDocumentPng(path: string): Promise<Blob> {
  const { data: html } = await apiClient.get<string>(path, {
    responseType: 'text',
  })

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.top = '0'
  frame.style.left = '-10000px'
  frame.style.width = `${A4_WIDTH_PX}px`
  frame.style.border = '0'

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true })
  })
  frame.srcdoc = html
  document.body.appendChild(frame)

  try {
    await loaded
    const body = frame.contentDocument?.body
    if (!body) {
      throw new Error('Could not open the invoice document for capture.')
    }
    const blob = await toBlob(body, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })
    if (!blob) {
      throw new Error('Could not render the invoice document to an image.')
    }
    return blob
  } finally {
    frame.remove()
  }
}

/** The printable invoice (GET /invoices/:id/document). */
export function captureInvoiceImagePng(invoiceId: string): Promise<Blob> {
  return captureDocumentPng(`/invoices/${invoiceId}/document`)
}

/** The ready-for-collection card (GET /invoices/:id/ready-card). */
export function captureReadyCardImagePng(invoiceId: string): Promise<Blob> {
  return captureDocumentPng(`/invoices/${invoiceId}/ready-card`)
}
