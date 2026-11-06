import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { GiftCard } from './types/gift-card'
import { GiftCardDetailPage } from './gift-card-detail'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string
    params?: { code: string }
    children: ReactNode
    className?: string
  }) => (
    <a
      href={to.replace('$code', encodeURIComponent(params?.code ?? ''))}
      className={className}
    >
      {children}
    </a>
  ),
}))
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { roles: ['manager'] },
  }),
}))

const card: GiftCard = {
  id: 'card',
  code: 'GC-7KMP-4RWT-9DXH',
  issuedBy: null,
  taxedAtIssue: false,
  replacesCardId: null,
  replacesCardCode: null,
  replacedByCardId: null,
  replacedByCardCode: null,
  initialAmount: 55,
  balance: 55,
  customerId: null,
  customerName: null,
  boughtFor: 'Recipient',
  recipientPhone: '+97333112233',
  deliveryStatus: null,
  deliveryError: null,
  expiresOn: '2000-01-01',
  isActive: true,
}

function show(value: GiftCard | null) {
  const client = new QueryClient()
  client.setQueryData(['gift-card', card.code], value)
  client.setQueryData(['users'], [])
  render(
    <QueryClientProvider client={client}>
      <GiftCardDetailPage code={card.code} />
    </QueryClientProvider>,
  )
}

it('shows the selected card and clickable replacement history in both directions', () => {
  show({
    ...card,
    isActive: false,
    balance: 0,
    replacesCardId: 'parent',
    replacesCardCode: 'GC-8BNQ-5SVX-3FYJ',
    replacedByCardId: 'child',
    replacedByCardCode: 'GC-6CZR-2HKT-8WPM',
  })
  expect(screen.getByRole('heading', { name: card.code })).toBeTruthy()
  expect(screen.getByText('Replaced')).toBeTruthy()
  expect(
    screen
      .getByRole('link', { name: 'GC-6CZR-2HKT-8WPM' })
      .getAttribute('href'),
  ).toBe('/gift-cards/GC-6CZR-2HKT-8WPM')
  expect(
    screen
      .getByRole('link', { name: 'GC-8BNQ-5SVX-3FYJ' })
      .getAttribute('href'),
  ).toBe('/gift-cards/GC-8BNQ-5SVX-3FYJ')
  expect(screen.getByRole('button', { name: 'Replace card' })).toHaveProperty(
    'disabled',
    true,
  )
})

it('lets a manager open renewal for expired uninvoiced credit', () => {
  show(card)
  expect(screen.getByText('Expired')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Replace card' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'New expiry date (optional)' }),
  ).toBeTruthy()
})

it('keeps expired paid value ineligible for renewal', () => {
  show({ ...card, taxedAtIssue: true })
  expect(screen.getByRole('button', { name: 'Replace card' })).toHaveProperty(
    'disabled',
    true,
  )
})

it('handles a replacement link whose code cannot be found', () => {
  show(null)
  expect(screen.getByRole('alert').textContent).toBe('Gift card not found.')
  expect(
    screen
      .getByRole('link', { name: 'Back to Gift Cards' })
      .getAttribute('href'),
  ).toBe('/gift-cards')
})
