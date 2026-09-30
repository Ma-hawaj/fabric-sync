import { afterEach, describe, expect, it, vi } from 'vitest'
import { printInvoiceDocument } from './print-invoice'
import { ApiError, apiClient } from '@/lib/api'

const DOCUMENT_PDF = new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' })
const BLOB_URL = 'blob:mock-invoice-pdf'

function mockGet(result: { data?: Blob; status?: number; ok?: boolean }) {
  const { ok = true, status = 200, data = DOCUMENT_PDF } = result
  const getMock = vi
    .spyOn(apiClient, 'get')
    .mockImplementation(() =>
      ok
        ? Promise.resolve({ data, status })
        : Promise.reject(new ApiError(`Request failed (${status})`, status)),
    )
  return getMock
}

// jsdom implements neither printing nor iframe loading: no load event ever
// fires on its own. Both are stubbed so the helper's own sequencing is
// what's under test. jsdom also has no URL.createObjectURL at all.
function stubIframeBehaviour() {
  const print = vi.fn()
  const createObjectURL = vi.fn(() => BLOB_URL)
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
    {
      print,
      focus: vi.fn(),
      addEventListener: vi.fn(),
    } as unknown as Window,
  )

  return { print, createObjectURL, revokeObjectURL }
}

// The helper awaits the frame's load event, which jsdom never fires by
// itself — dispatch it once the frame is in the document.
function fireLoad() {
  setTimeout(() => {
    document.querySelector('iframe')?.dispatchEvent(new Event('load'))
  }, 0)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('printInvoiceDocument', () => {
  it('prints the PDF the backend rendered, in a hidden frame', async () => {
    const getMock = mockGet({})
    const { print, createObjectURL } = stubIframeBehaviour()

    const pending = printInvoiceDocument('inv-1')
    fireLoad()
    await pending

    expect(getMock).toHaveBeenCalledWith('/invoices/inv-1/document', {
      responseType: 'blob',
    })

    // The fetched bytes are handed to the viewer as a blob URL rather than
    // the frame being pointed at the API URL, so the request can carry auth
    // headers.
    expect(createObjectURL).toHaveBeenCalledWith(DOCUMENT_PDF)
    const frame = document.querySelector('iframe')
    expect(frame).toBeTruthy()
    expect(frame?.getAttribute('src')).toBe(BLOB_URL)
    expect(frame?.style.visibility).toBe('hidden')
    expect(print).toHaveBeenCalled()
  })

  it('throws an ApiError carrying the status when the document fails to load', async () => {
    mockGet({ ok: false, status: 404 })
    stubIframeBehaviour()

    await expect(printInvoiceDocument('inv-1')).rejects.toThrow(ApiError)
    // Nothing was appended, so a failed export leaves no orphaned frame.
    expect(document.querySelector('iframe')).toBeNull()
  })
})
