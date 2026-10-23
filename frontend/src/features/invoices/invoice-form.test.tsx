import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceFormPage } from './invoice-form'

// Hoisted by vitest above these imports at transform time.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

function renderPage() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <InvoiceFormPage />
    </QueryClientProvider>,
  )
}

describe('InvoiceFormPage validation (zod + TanStack Form)', () => {
  it('requires a target date for an urgent order and clears the error when that order becomes regular', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add Another Order' }))
    const urgentOptions = screen.getAllByRole('switch', {
      name: /Urgent order/,
    })
    fireEvent.click(urgentOptions[0])
    expect(urgentOptions[0].getAttribute('aria-checked')).toBe('true')
    expect(urgentOptions[1].getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(
      await screen.findByText('Pick a target date for urgent orders.'),
    ).toBeTruthy()
    expect(
      screen
        .getByLabelText('Target Date (required)')
        .getAttribute('aria-invalid'),
    ).toBe('true')

    fireEvent.click(urgentOptions[0])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    await waitFor(() => {
      expect(
        screen.queryByText('Pick a target date for urgent orders.'),
      ).toBeNull()
    })
  })
  it('shows the zod error inline on the field and a banner, blocking submit', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(
        'Pick an existing customer or switch to "+ New Customer".',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Please fix the highlighted fields before saving.'),
    ).toBeTruthy()
  })

  it('clears the error on the next submit attempt once the field is fixed', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(
      'Pick an existing customer or switch to "+ New Customer".',
    )

    // Switch to a new adult customer with a name and phone — now valid,
    // aside from still needing a material/quantity on the order.
    fireEvent.click(screen.getByText('+ New Customer'))
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Ahmed Al-Mansoori' },
    })
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: '+971-50-1234567' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      screen.queryByText(
        'Pick an existing customer or switch to "+ New Customer".',
      ),
    ).toBeNull()
    expect(
      await screen.findByText('Pick a material and quantity.'),
    ).toBeTruthy()
  })
})
