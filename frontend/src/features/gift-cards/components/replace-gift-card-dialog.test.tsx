import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReplaceGiftCardDialog } from './replace-gift-card-dialog'
import type { GiftCard } from '../types/gift-card'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiClient: { post } }))
const original: GiftCard = {
  id: 'old-card',
  code: 'GC-7KMP-4RWT-9DXH',
  issuedBy: 'seller',
  taxedAtIssue: true,
  replacesCardId: null,
  replacesCardCode: null,
  replacedByCardId: null,
  replacedByCardCode: null,
  initialAmount: 110,
  balance: 55,
  customerId: null,
  customerName: null,
  boughtFor: 'Recipient',
  recipientPhone: '+97333112233',
  deliveryStatus: null,
  deliveryError: null,
  expiresOn: null,
  isActive: true,
}
const replacement: GiftCard = {
  ...original,
  id: 'new-card',
  code: 'GC-8BNQ-5SVX-3FYJ',
  issuedBy: 'manager',
  initialAmount: 55,
  replacesCardId: original.id,
  replacesCardCode: original.code,
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function show() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const close = vi.fn()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <ReplaceGiftCardDialog card={original} onClose={close} />
    </QueryClientProvider>,
  )
  return { close, invalidate }
}

it('transfers via the source-card endpoint and displays the actual issued code and balance', async () => {
  post.mockResolvedValue({ data: replacement })
  const { close, invalidate } = show()
  expect(screen.getByText('BHD 55.00')).toBeTruthy()
  expect(screen.getByText(original.code)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Replace card' }))
  expect(
    await screen.findByRole('heading', { name: 'Replacement card issued' }),
  ).toBeTruthy()
  expect(post).toHaveBeenCalledWith('/gift-cards/old-card/replace')
  expect(screen.getByLabelText('New gift card code').textContent).toBe(
    replacement.code,
  )
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gift-card'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gift-cards'] })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(close).toHaveBeenCalledOnce()
})

it('keeps errors visible without claiming a replacement was issued', async () => {
  post.mockRejectedValue(new Error('This card has already been replaced.'))
  const { close } = show()
  fireEvent.click(screen.getByRole('button', { name: 'Replace card' }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'This card has already been replaced.',
  )
  expect(
    screen.queryByRole('heading', { name: 'Replacement card issued' }),
  ).toBeNull()
  expect(close).not.toHaveBeenCalled()
})

it('prevents repeated clicks while the transfer is pending', async () => {
  let finish: (value: { data: GiftCard }) => void = () => {}
  post.mockReturnValue(
    new Promise<{ data: GiftCard }>((resolve) => {
      finish = resolve
    }),
  )
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Replace card' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Replacing…' })).toHaveProperty(
      'disabled',
      true,
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Replacing…' }))
  expect(post).toHaveBeenCalledOnce()
  finish({ data: replacement })
  expect(
    await screen.findByRole('heading', { name: 'Replacement card issued' }),
  ).toBeTruthy()
})
