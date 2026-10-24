import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import { DesignPicker } from './design-picker'
import type { DesignOption } from '@/features/design-options/types/design-option'

const OPTIONS: DesignOption[] = [
  {
    id: 'classic',
    category: 'neck',
    slug: 'classic',
    label: 'Classic',
    cost: 0,
    sortOrder: 0,
    isActive: true,
    hasImage: false,
    imageUrl: '',
  },
  {
    id: 'round',
    category: 'neck',
    slug: 'round',
    label: 'Rounded',
    cost: 1,
    sortOrder: 1,
    isActive: true,
    hasImage: false,
    imageUrl: '',
  },
  {
    id: 'retired',
    category: 'neck',
    slug: 'retired',
    label: 'Old collar',
    cost: 2,
    sortOrder: 2,
    isActive: false,
    hasImage: false,
    imageUrl: '',
  },
]

function Harness({ collar = 'classic' }: { collar?: string }) {
  const form = useForm({ defaultValues: { collar } })
  return (
    <>
      <DesignPicker
        form={form as never}
        name="collar"
        category="neck"
        label="Collar"
        options={OPTIONS}
      />
      <form.Subscribe selector={(state) => state.values.collar}>
        {(value) => <output data-testid="collar">{value}</output>}
      </form.Subscribe>
    </>
  )
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose Collar' }))
}

describe('DesignPicker', () => {
  it('reveals one category and only commits a selection when applied', () => {
    render(<Harness />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    openPicker()
    fireEvent.click(screen.getByRole('radio', { name: /Rounded/ }))
    expect(screen.getByTestId('collar').textContent).toBe('classic')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('collar').textContent).toBe('classic')
    openPicker()
    expect(
      screen
        .getByRole('radio', { name: /Classic/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /Rounded/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply design' }))
    expect(screen.getByTestId('collar').textContent).toBe('round')
  })

  it('searches designs without clearing a selection', () => {
    render(<Harness />)
    openPicker()
    fireEvent.change(screen.getByLabelText('Search Collar designs'), {
      target: { value: 'round' },
    })
    expect(screen.queryByRole('radio', { name: /Classic/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /Rounded/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search Collar designs'), {
      target: { value: 'missing' },
    })
    expect(screen.getByText('No designs match your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply design' }))
    expect(screen.getByTestId('collar').textContent).toBe('classic')
  })

  it('preserves retired designs while excluding them from new choices', () => {
    render(<Harness collar="retired" />)
    openPicker()
    expect(screen.getByText(/Saved option Old collar is retired/)).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Old collar/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Apply design' }))
    expect(screen.getByTestId('collar').textContent).toBe('retired')
  })

  it('keeps a legacy value until staff explicitly clear or replace it', () => {
    render(<Harness collar="legacy" />)
    openPicker()
    expect(
      screen.getByText(/Saved value “legacy” is not in the catalog/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('collar').textContent).toBe('legacy')
    openPicker()
    fireEvent.click(screen.getByRole('radio', { name: 'Not specified' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply design' }))
    expect(screen.getByTestId('collar').textContent).toBe('')
  })
})
