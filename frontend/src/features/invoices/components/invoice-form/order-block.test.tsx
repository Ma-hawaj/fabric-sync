import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import { selectOption } from '@/test/select-utils'
import { OrderBlock } from './order-block'
import { createEmptyCustomer } from '../../types/invoice-form'
import { MATERIALS } from '../../data/invoice-form-options'

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
  it('shows a zero line total until a material and quantity are set', () => {
    render(<Harness />)
    expect(screen.getByText('SAR 0.00')).toBeTruthy()
  })

  it('computes the line total from the selected material and quantity', async () => {
    render(<Harness />)

    const woolBlend = MATERIALS.find((m) => m.name.includes('Wool Blend'))!
    await pickMaterial(`${woolBlend.name} (${woolBlend.code})`)

    fireEvent.change(screen.getByLabelText('Quantity (m)'), {
      target: { value: '3' },
    })

    expect(
      await screen.findByText(
        `SAR ${(woolBlend.pricePerMeter * 3).toFixed(2)}`,
      ),
    ).toBeTruthy()
  })

  it("shows the material's available stock once selected", async () => {
    render(<Harness />)

    const woolBlend = MATERIALS.find((m) => m.name.includes('Wool Blend'))!
    await pickMaterial(`${woolBlend.name} (${woolBlend.code})`)

    expect(
      await screen.findByText(
        `Available: ${woolBlend.availableMeters}m — ${woolBlend.storageLocation}`,
      ),
    ).toBeTruthy()
  })
})
