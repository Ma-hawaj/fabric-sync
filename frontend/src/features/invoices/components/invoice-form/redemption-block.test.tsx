import { useForm } from '@tanstack/react-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
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

afterEach(cleanup)

it('lets staff type only twelve characters and fills the stored code after lookup', async () => {
  const client = new QueryClient()
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
