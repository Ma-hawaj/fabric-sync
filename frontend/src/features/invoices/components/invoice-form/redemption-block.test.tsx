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
import type { InvoiceFormValues } from '../../types/invoice-form'

function Harness({
  originalCode,
  amount = '',
}: { originalCode?: string; amount?: number | '' } = {}) {
  const defaultValues: InvoiceFormValues = {
    ...createEmptyInvoiceForm(),
    redemptions: [{ ...createEmptyRedemption(), originalCode, amount }],
  }
  const form = useForm({ defaultValues })
  return (
    <>
      <RedemptionBlock
        form={form}
        lineIndex={0}
        date="2026-10-24"
        onRemove={() => {}}
      />
      <form.Subscribe
        selector={(state) => state.values.redemptions[0].taxedAtIssue}
      >
        {(taxedAtIssue) => (
          <output data-testid="taxed-at-issue">
            {String(taxedAtIssue ?? false)}
          </output>
        )}
      </form.Subscribe>
    </>
  )
}

const card: GiftCard = {
  issuedBy: null,
  taxedAtIssue: false,
  replacesCardId: null,
  replacesCardCode: null,
  replacedByCardId: null,
  replacedByCardCode: null,
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

it.each([false, true])(
  'accepts a replaced code only when it is existing invoice tender: %s',
  async (existing) => {
    const client = new QueryClient()
    client.setQueryData(['gift-card', '7KMP4RWT9DXH'], {
      ...card,
      balance: 0,
      isActive: false,
      taxedAtIssue: true,
      replacedByCardId: 'new-card',
      replacedByCardCode: 'GC-8BNQ-5SVX-3FYJ',
    })
    render(
      <QueryClientProvider client={client}>
        <Harness
          originalCode={existing ? card.code : undefined}
          amount={existing ? 33 : ''}
        />
      </QueryClientProvider>,
    )
    const code = screen.getByRole('textbox', { name: 'Gift Card Code' })
    fireEvent.change(code, { target: { value: '7KMP4RWT9DXH' } })
    if (existing) {
      expect(
        await screen.findByText(
          /Existing redemption\. Changes apply to replacement/,
        ),
      ).toBeTruthy()
      await waitFor(() =>
        expect(screen.getByTestId('taxed-at-issue').textContent).toBe('true'),
      )
      expect(
        screen.getByRole('textbox', { name: 'Apply (BHD)' }),
      ).toHaveProperty('value', '33')
      expect(code.getAttribute('aria-invalid')).toBe('false')
    } else {
      expect(
        await screen.findByText(/This card was replaced\. Use/),
      ).toBeTruthy()
      expect(screen.getByTestId('taxed-at-issue').textContent).toBe('false')
      expect(code.getAttribute('aria-invalid')).toBe('true')
    }
  },
)

it.each([false, true])(
  'accepts a card with taxedAtIssue=%s and records its preview provenance',
  async (taxedAtIssue) => {
    const client = new QueryClient()
    client.setQueryData(['gift-card', '7KMP4RWT9DXH'], {
      ...card,
      taxedAtIssue,
    })
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )
    const code = screen.getByRole('textbox', { name: 'Gift Card Code' })
    fireEvent.change(code, { target: { value: '7KMP4RWT9DXH' } })
    expect(await screen.findByText('BHD 50.00 available.')).toBeTruthy()
    expect(code.getAttribute('aria-invalid')).toBe('false')
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Apply (BHD)' }),
      ).toHaveProperty('value', '50'),
    )
    expect(screen.getByTestId('taxed-at-issue').textContent).toBe(
      String(taxedAtIssue),
    )
    fireEvent.change(code, { target: { value: '8BNQ5SVX3FYJ' } })
    expect(screen.getByTestId('taxed-at-issue').textContent).toBe('false')
  },
)

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
