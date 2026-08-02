import { afterEach, describe, expect, it, vi } from 'vitest'
import { printInvoiceDocument } from './print-invoice'
import { ApiError, apiClient } from '@/lib/api'

const DOCUMENT_HTML = '<!doctype html><html><body>Invoice INV-42</body></html>'

function mockGet(result: { data?: string; status?: number; ok?: boolean }) {
  const { ok = true, status = 200, data = DOCUMENT_HTML } = result
  const getMock = vi
    .spyOn(apiClient, 'get')
    .mockImplementation(() =>
      ok
        ? Promise.resolve({ data, status })
        : Promise.reject(new ApiError(`Request failed (${status})`, status)),
    )
  return getMock
}

// jsdom implements neither printing nor iframe loading: nothing sets srcdoc
// going, so no load event ever fires. Both are stubbed so the helper's own
// sequencing is what's under test.
function stubIframeBehaviour() {
  const print = vi.fn()
  const originalSrcdoc = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    'srcdoc',
  )

  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    configurable: true,
    set(this: HTMLIFrameElement, value: string) {
      this.setAttribute('srcdoc', value)
      // A real browser fires this once the document has parsed.
      setTimeout(() => this.dispatchEvent(new Event('load')), 0)
    },
    get(this: HTMLIFrameElement) {
      return this.getAttribute('srcdoc') ?? ''
    },
  })

  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
    {
      print,
      focus: vi.fn(),
      addEventListener: vi.fn(),
    } as unknown as Window,
  )

  return {
    print,
    restore: () => {
      if (originalSrcdoc) {
        Object.defineProperty(
          HTMLIFrameElement.prototype,
          'srcdoc',
          originalSrcdoc,
        )
      }
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('printInvoiceDocument', () => {
  it('prints the document the backend rendered, in a hidden frame', async () => {
    const getMock = mockGet({})
    const { print, restore } = stubIframeBehaviour()

    await printInvoiceDocument('inv-1')

    expect(getMock).toHaveBeenCalledWith('/invoices/inv-1/document', {
      responseType: 'text',
    })

    const frame = document.querySelector('iframe')
    expect(frame).toBeTruthy()
    // The fetched HTML is written into the frame rather than the frame being
    // pointed at the URL, so the request can carry auth headers.
    expect(frame?.getAttribute('srcdoc')).toBe(DOCUMENT_HTML)
    expect(frame?.style.visibility).toBe('hidden')
    expect(print).toHaveBeenCalled()

    restore()
  })

  it('throws an ApiError carrying the status when the document fails to load', async () => {
    mockGet({ ok: false, status: 404 })
    const { restore } = stubIframeBehaviour()

    await expect(printInvoiceDocument('inv-1')).rejects.toThrow(ApiError)
    // Nothing was appended, so a failed export leaves no orphaned frame.
    expect(document.querySelector('iframe')).toBeNull()

    restore()
  })
})
