import { useForm } from '@tanstack/react-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { RedemptionBlock } from './redemption-block'
import {
  createEmptyInvoiceForm,
  createEmptyRedemption,
} from '../../types/invoice-form'
import type { GiftCard } from '@/features/gift-cards/types/gift-card'

function Harness() {
  const form = useForm({
    defaultValues: {
      ...createEmptyInvoiceForm(),
      redemptions: [createEmptyRedemption()],
    },
  })
  return (
    <RedemptionBlock
      form={form}
      lineIndex={0}
      date="2026-10-24"
      onRemove={() => {}}
    />
  )
}

const card: GiftCard = {
  id: 'card-1',
  code: 'GC-7KMP-4RWT-9DXH',
  initialAmount: 50,
  balance: 50,
  customerId: null,
  customerName: null,
  boughtFor: null,
  recipientPhone: null,
  deliveryStatus: null,
  deliveryError: null,
  expiresOn: null,
  isActive: true,
}

afterEach(cleanup)

it('lets staff type only twelve characters and fills the stored code after lookup', async () => {
  const client = new QueryClient()
  client.setQueryData(['gift-card', '7KMP4RWT9DXH'], card)
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  const input = screen.getByRole('textbox', {
    name: 'Gift Card Code',
  })
  fireEvent.change(input, { target: { value: '7kmp4rwt9dxh' } })
  await waitFor(
    () => expect(input).toHaveProperty('value', 'GC-7KMP-4RWT-9DXH'),
    {
      timeout: 2000,
    },
  )
  expect(screen.getByText('BHD 50.00 available.')).toBeTruthy()
})

it.each(['8BNQ5SVX3FYJ', ''])(
  'does not overwrite newer input %j or its amount when an earlier lookup finishes',
  async (newerCode) => {
    const client = new QueryClient()
    let resolve: (value: GiftCard) => void = () => {}
    const firstLookup = client.fetchQuery({
      queryKey: ['gift-card', '7KMP4RWT9DXH'],
      queryFn: () =>
        new Promise<GiftCard>((done) => {
          resolve = done
        }),
    })
    const second = {
      ...card,
      id: 'card-2',
      code: 'GC-8BNQ-5SVX-3FYJ',
      balance: 125,
    }
    client.setQueryData(['gift-card', '8BNQ5SVX3FYJ'], second)
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )
    const codeInput = screen.getByRole('textbox', { name: 'Gift Card Code' })
    const amountInput = screen.getByRole('textbox', { name: 'Apply (BHD)' })
    fireEvent.change(codeInput, { target: { value: '7KMP4RWT9DXH' } })
    await screen.findByText('Checking…')
    fireEvent.change(codeInput, { target: { value: newerCode } })
    await act(async () => {
      resolve(card)
      await firstLookup
    })
    expect(codeInput).toHaveProperty('value', newerCode)
    expect(amountInput).toHaveProperty('value', '')
    if (newerCode) {
      await waitFor(() =>
        expect(codeInput).toHaveProperty('value', second.code),
      )
      expect(amountInput).toHaveProperty('value', '125')
    }
  },
)
