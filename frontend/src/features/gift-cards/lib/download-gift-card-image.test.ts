import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadGiftCardImage } from './download-gift-card-image'
import { apiClient } from '@/lib/api'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn() } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('gift card image download', () => {
  it('fetches the protected PNG through the API and downloads it as an image', async () => {
    vi.useFakeTimers()
    const png = new Blob(['PNG'], { type: 'image/png' })
    vi.mocked(apiClient.get).mockResolvedValue({ data: png })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:gift-card'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.href).toBe('blob:gift-card')
        expect(this.download).toBe('gift-card-test-card.png')
      })
    await downloadGiftCardImage('test-card')
    expect(apiClient.get).toHaveBeenCalledWith('/gift-cards/test-card/image', {
      responseType: 'blob',
    })
    expect(URL.createObjectURL).toHaveBeenCalledWith(png)
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download]')).toBeNull()
    await vi.runAllTimersAsync()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:gift-card')
  })
})
