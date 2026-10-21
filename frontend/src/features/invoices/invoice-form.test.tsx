import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

it('adds direct material lines after removing the tailoring customer block', async () => {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Customer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add Material' }))
  expect(screen.getByLabelText('Material')).toBeTruthy()
  expect(screen.getByLabelText('Sold From')).toBeTruthy()
  expect(screen.queryByText('Pick where this order is made.')).toBeNull()
  fireEvent.change(screen.getByLabelText('Quantity'), {
    target: { value: '2.5' },
  })
  fireEvent.change(screen.getByLabelText(/Price per unit/), {
    target: { value: '11' },
  })
  expect(await screen.findByText(/Line total:.*27\.50/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Pick a material.')).toBeTruthy()
  expect(
    screen.queryByText(
      'Pick an existing customer or switch to "+ New Customer".',
    ),
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Remove material' }))
  expect(screen.queryByLabelText('Material')).toBeNull()
})
