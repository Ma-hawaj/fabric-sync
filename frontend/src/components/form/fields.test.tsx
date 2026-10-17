import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import { DateField } from './fields'

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
