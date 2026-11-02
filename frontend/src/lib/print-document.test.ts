import { afterEach, expect, it, vi } from 'vitest'
import { printHtmlDocument } from './print-document'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

it('waits for fonts, images and page fitting before opening print', async () => {
  vi.useFakeTimers()
  const fonts = deferred()
  const image = deferred()
  const fitting = deferred()
  const print = vi.fn()
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
    {
      document: {
        fonts: { ready: fonts.promise },
        images: [{ decode: () => image.promise }],
      },
      documentPrintReady: fitting.promise,
      addEventListener: vi.fn(),
      focus: vi.fn(),
      print,
    } as unknown as Window,
  )

  const printing = printHtmlDocument('<html>Complete order</html>', 'order')
  document.querySelector('iframe')!.dispatchEvent(new Event('load'))
  await vi.advanceTimersByTimeAsync(0)
  expect(print).not.toHaveBeenCalled()
  fonts.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(print).not.toHaveBeenCalled()
  image.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(print).not.toHaveBeenCalled()
  fitting.resolve()
  await printing
  expect(print).toHaveBeenCalledOnce()
})

it('removes the frame if page preparation fails', async () => {
  const print = vi.fn()
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
    {
      document: { fonts: { ready: Promise.resolve() }, images: [] },
      documentPrintReady: Promise.reject(
        new Error('Could not prepare the page'),
      ),
      print,
    } as unknown as Window,
  )

  const printing = printHtmlDocument('<html>Repair</html>', 'repair')
  const failure = expect(printing).rejects.toThrow('Could not prepare the page')
  document.querySelector('iframe')!.dispatchEvent(new Event('load'))
  await failure
  expect(document.querySelector('iframe')).toBeNull()
  expect(print).not.toHaveBeenCalled()
})
