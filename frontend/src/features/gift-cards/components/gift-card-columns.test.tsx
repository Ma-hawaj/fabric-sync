import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table/data-table'
import { STAFF_USER } from '@/features/users/test-fixtures'
import type { GiftCard } from '../types/gift-card'
import { getGiftCardColumns } from './gift-card-columns'

const card: GiftCard = {
  id: 'card-one',
  code: 'GC-7KMP-4RWT-9DXH',
  issuedBy: STAFF_USER.id,
  taxedAtIssue: false,
  replacesCardId: null,
  replacesCardCode: null,
  replacedByCardId: null,
  replacedByCardCode: null,
  initialAmount: 50,
  balance: 50,
  customerId: null,
  customerName: null,
  boughtFor: 'Recipient',
  recipientPhone: '+97333112233',
  deliveryStatus: null,
  deliveryError: null,
  expiresOn: null,
  isActive: true,
}
const columns = getGiftCardColumns(
  vi.fn(),
  false,
  '2026-11-04',
  vi.fn(),
  vi.fn(),
  vi.fn(),
  false,
  vi.fn(),
)

function GiftCardTable({ data }: { data: GiftCard[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  return <DataTable table={table} />
}

function renderTable(value: GiftCard) {
  const client = new QueryClient()
  client.setQueryData(['users'], [STAFF_USER])
  render(
    <QueryClientProvider client={client}>
      <GiftCardTable data={[value]} />
    </QueryClientProvider>,
  )
}

describe('gift-card issuer column', () => {
  it('shows the original code and the replacement relationship without a card type', () => {
    renderTable({
      ...card,
      replacesCardId: 'old-card',
      replacesCardCode: 'GC-8BNQ-5SVX-3FYJ',
    })
    expect(
      screen.getByRole('columnheader', { name: /Replacement link/ }),
    ).toBeTruthy()
    expect(screen.getByText('GC-8BNQ-5SVX-3FYJ')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Type' })).toBeNull()
  })
  it('shows the issuing staff name instead of the authentication subject', () => {
    renderTable(card)
    expect(screen.getByRole('columnheader', { name: /Issued by/ })).toBeTruthy()
    expect(screen.getByText(STAFF_USER.name)).toBeTruthy()
    expect(screen.queryByText(STAFF_USER.id, { exact: true })).toBeNull()
  })

  it('shows a clear fallback when the original issuer is unknown', () => {
    renderTable({ ...card, issuedBy: null })
    expect(screen.getByText('Staff not recorded')).toBeTruthy()
  })
})
