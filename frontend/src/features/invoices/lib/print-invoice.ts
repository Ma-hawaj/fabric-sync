import { apiClient } from '@/lib/api'

// How long to wait for the print dialog before tearing the iframe down, when
// the browser gives us no afterprint event to go on (Safari doesn't fire one
// for an iframe). Removing the frame while the dialog is still open cancels
// the print, so this errs long — an orphaned hidden iframe costs nothing.
const TEARDOWN_FALLBACK_MS = 60_000

/**
 * Prints an invoice, by way of the document the backend renders for it.
 *
 * The HTML is fetched and written into a hidden iframe rather than navigated
 * to, for two reasons: the app's own page — sidebar, toolbars and all — never
 * enters the print output, and the request goes through `apiClient`, so it
 * carries an Authorization header. A plain `<iframe src>` could not.
 *
 * Resolves once the print dialog has been opened, not once the user has
 * finished with it — the browser gives no way to tell whether they saved a PDF
 * or cancelled.
 */
export async function printInvoiceDocument(invoiceId: string): Promise<void> {
  const { data: html } = await apiClient.get<string>(
    `/invoices/${invoiceId}/document`,
    { responseType: 'text' },
  )

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.style.visibility = 'hidden'

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true })
  })

  // srcdoc rather than a blob URL: the document is entirely self-contained, so
  // it needs no origin of its own to resolve anything against, and there is no
  // object URL left to revoke.
  frame.srcdoc = html
  document.body.appendChild(frame)

  await loaded

  const view = frame.contentWindow
  if (!view) {
    frame.remove()
    throw new Error('Could not open the invoice document for printing.')
  }

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    frame.remove()
  }

  view.addEventListener('afterprint', remove, { once: true })
  window.setTimeout(remove, TEARDOWN_FALLBACK_MS)

  view.focus()
  view.print()
}
