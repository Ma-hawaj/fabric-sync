import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import { selectOption } from '@/test/select-utils'
import { OrderBlock } from './order-block'
import { createEmptyCustomer } from '../../types/invoice-form'
import type { Material } from '../../types/materials'

const MATERIALS: Material[] = [
  {
    id: 'mat-1',
    name: 'Cotton Poplin — White',
    sku: 'FB-CTN-WHT-01',
    unit: 'meters',
    locations: [
      { locationId: 'loc-1', location: 'Main Warehouse', quantity: 100 },
      { locationId: 'loc-2', location: 'Downtown Branch', quantity: 20 },
    ],
  },
  {
    id: 'mat-2',
    name: 'Wool Blend — Grey',
    sku: null,
    unit: 'meters',
    locations: [],
  },
]

function Harness() {
  const form = useForm({
    defaultValues: { customers: [createEmptyCustomer()] },
  })
  return (
    <OrderBlock
      form={form as never}
      customerIndex={0}
      orderIndex={0}
      orderNumber={1}
      materials={MATERIALS}
      removable={false}
      onRemove={() => {}}
    />
  )
}

async function pickMaterial(name: RegExp | string) {
  fireEvent.click(screen.getByText('Select material...'))
  const option = await screen.findByRole('option', { name })
  selectOption(option)
}

describe('OrderBlock', () => {
  it('lists fetched materials with their SKU when present', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByText('Select material...'))
    expect(
      await screen.findByRole('option', {
        name: 'Cotton Poplin — White (FB-CTN-WHT-01)',
      }),
    ).toBeTruthy()
    expect(
      await screen.findByRole('option', { name: 'Wool Blend — Grey' }),
    ).toBeTruthy()
  })

  it("shows the material's stock across locations once selected", async () => {
    render(<Harness />)

    await pickMaterial('Cotton Poplin — White (FB-CTN-WHT-01)')

    expect(
      await screen.findByText(
        'Available: 120 meters — Main Warehouse: 100, Downtown Branch: 20',
      ),
    ).toBeTruthy()
  })

  it('has a manual price field for the order line', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Price (SAR)')).toBeTruthy()
  })
})
