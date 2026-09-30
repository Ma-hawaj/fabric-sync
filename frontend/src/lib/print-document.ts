// How long to wait for the print dialog before tearing the iframe down, when
// the browser gives us no afterprint event to go on (Safari doesn't fire one
// for an iframe). Removing the frame while the dialog is still open cancels
// the print, so this errs long — an orphaned hidden iframe costs nothing.
const TEARDOWN_FALLBACK_MS = 60_000

/**
 * Prints a PDF document by the fastest path available: loaded into a hidden
 * iframe from a blob URL and printed from there.
 *
 * The PDF bytes are fetched by whatever called this and handed over as a
 * `Blob` rather than navigated to, for two reasons: the app's own page —
 * sidebar, toolbars and all — never enters the print output, and the fetch
 * can carry an Authorization header. A plain `<iframe src>` pointed at the
 * API URL could not.
 *
 * Resolves once the print dialog has been opened, not once the user has
 * finished with it — the browser gives no way to tell whether they saved a
 * PDF or cancelled.
 */
export async function printPdfDocument(
  pdf: Blob,
  label: string,
): Promise<void> {
  const url = URL.createObjectURL(
    pdf.type === 'application/pdf'
      ? pdf
      : new Blob([pdf], { type: 'application/pdf' }),
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

  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true })
    frame.addEventListener(
      'error',
      () => reject(new Error(`Could not open the ${label} document.`)),
      { once: true },
    )
  })

  // A blob URL rather than srcdoc: the payload is binary PDF, not HTML, and
  // the frame needs an origin of its own to load the viewer's plugin against.
  // The URL is revoked once the frame is torn down.
  frame.src = url
  document.body.appendChild(frame)

  try {
    await loaded
  } catch (error) {
    frame.remove()
    URL.revokeObjectURL(url)
    throw error
  }

  const view = frame.contentWindow
  if (!view) {
    frame.remove()
    URL.revokeObjectURL(url)
    throw new Error(`Could not open the ${label} document for printing.`)
  }

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    frame.remove()
    URL.revokeObjectURL(url)
  }

  view.addEventListener('afterprint', remove, { once: true })
  window.setTimeout(remove, TEARDOWN_FALLBACK_MS)

  view.focus()
  view.print()
}
