import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import { DateField, NumberField } from './fields'

function Harness({ defaultDate = '' }: { defaultDate?: string }) {
  const form = useForm({ defaultValues: { date: defaultDate } })
  return <DateField form={form} name="date" label="Date" />
}

describe('DateField', () => {
  it('shows the placeholder when blank', () => {
    render(<Harness />)

    expect(screen.getByText('Pick a date')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Clear Date' }).className,
    ).toMatch(/invisible/)
  })

  it('shows the picked day for a set ISO date', () => {
    render(<Harness defaultDate="2026-07-25" />)

    expect(
      screen.getByText(new Date(2026, 6, 25).toLocaleDateString()),
    ).toBeTruthy()
  })

  it('treats a malformed value as blank', () => {
    render(<Harness defaultDate="not-a-date" />)

    expect(screen.getByText('Pick a date')).toBeTruthy()
  })

  it('clears back to blank', () => {
    render(<Harness defaultDate="2026-07-25" />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear Date' }))

    expect(screen.getByText('Pick a date')).toBeTruthy()
  })

  it('opens a calendar to pick a day', async () => {
    render(<Harness />)

    // The FieldLabel names the trigger after the field, not the placeholder.
    fireEvent.click(screen.getByRole('button', { name: 'Date' }))

    expect(await screen.findByRole('grid')).toBeTruthy()
  })
})

function NumberHarness({
  initialAmount = '',
  unit,
}: {
  initialAmount?: number | ''
  unit?: string
}) {
  const form = useForm({
    defaultValues: { amount: initialAmount },
    validators: {
      onBlur: ({ value }) =>
        value.amount === ''
          ? { fields: { amount: { message: 'Enter an amount.' } } }
          : undefined,
    },
  })
  return (
    <>
      <NumberField form={form} name="amount" label="Amount" unit={unit} />
      <form.Subscribe selector={(state) => state.values.amount}>
        {(amount) => (
          <output data-testid="amount">{JSON.stringify(amount)}</output>
        )}
      </form.Subscribe>
    </>
  )
}

describe('NumberField', () => {
  it('keeps decimal edits as numbers and clears to the blank form value', () => {
    render(<NumberHarness initialAmount={12.375} />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    expect(screen.getByTestId('amount').textContent).toBe('12.375')
    fireEvent.change(input, { target: { value: '25.125' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('amount').textContent).toBe('25.125')
    expect((input as HTMLInputElement).value).toBe('25.125')
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('amount').textContent).toBe('""')
  })

  it('focuses from the unit suffix and preserves keyboard stepping', () => {
    render(<NumberHarness initialAmount={3} unit="cm" />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    fireEvent.click(screen.getByText('cm'))
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByTestId('amount').textContent).toBe('4')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByTestId('amount').textContent).toBe('3')
  })

  it('retains blur validation and accessible invalid feedback', async () => {
    render(<NumberHarness />)
    const input = screen.getByRole('textbox', { name: 'Amount' })
    fireEvent.blur(input)
    expect(await screen.findByText('Enter an amount.')).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
})
