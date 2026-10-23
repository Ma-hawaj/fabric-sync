import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { DateField, TextareaField } from './fields'

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

function AddressHarness() {
  const schema = z.object({
    address: z.string().min(1, 'Enter an address.'),
    instructions: z.string().min(1, 'Enter collection instructions.'),
  })
  const form = useForm({
    defaultValues: { address: '', instructions: '' },
    validators: { onSubmit: schema, onChange: schema },
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <TextareaField form={form} name="address" label="Address" />
      <TextareaField form={form} name="instructions" label="Instructions" />
      <button type="submit">Save</button>
    </form>
  )
}

describe('TextareaField', () => {
  it('associates each validation error with its textarea and clears the association after correction', async () => {
    render(<AddressHarness />)
    const address = screen.getByRole('textbox', { name: 'Address' })
    const instructions = screen.getByRole('textbox', { name: 'Instructions' })
    expect(address.getAttribute('aria-describedby')).toBeNull()
    expect(instructions.getAttribute('aria-describedby')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Enter an address.')
    const addressErrorId = address.getAttribute('aria-describedby')!
    const instructionsErrorId = instructions.getAttribute('aria-describedby')!
    expect(address.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(addressErrorId)?.textContent).toBe(
      'Enter an address.',
    )
    expect(document.getElementById(instructionsErrorId)?.textContent).toBe(
      'Enter collection instructions.',
    )
    expect(addressErrorId).not.toBe(instructionsErrorId)

    fireEvent.change(address, { target: { value: 'Building 10\nRoad 20' } })
    await waitFor(() => {
      expect(address.getAttribute('aria-invalid')).toBe('false')
      expect(address.getAttribute('aria-describedby')).toBeNull()
    })
    expect(instructions.getAttribute('aria-describedby')).toBe(
      instructionsErrorId,
    )
  })
})
