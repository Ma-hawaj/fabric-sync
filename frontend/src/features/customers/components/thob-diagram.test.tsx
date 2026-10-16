import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  THOBE_FIELDS,
  THOBE_VALUE_SLOTS,
  THOBE_VIEWBOX,
  ThobDiagram,
} from './thob-diagram'
import { MEASUREMENT_FIELDS } from '../data/measurement-fields'
import { createEmptyMeasurement } from '../types/measurement-form'

describe('ThobDiagram', () => {
  it('draws front and back together in one sheet', () => {
    const { container } = render(<ThobDiagram />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe(THOBE_VIEWBOX)
    expect(svg?.getAttribute('aria-label')).toBe('Thobe measurements')
  })

  it('renders recorded values at their slots', () => {
    render(
      <ThobDiagram values={{ chest: 42, frontPocketLengthByWidth: '16x14' }} />,
    )

    expect(screen.queryAllByText('42').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('16x14').length).toBeGreaterThan(0)
  })

  it('renders nothing when no values are recorded', () => {
    const { container } = render(<ThobDiagram values={{}} />)

    expect(container.querySelectorAll('[data-testid^="value-"]')).toHaveLength(
      0,
    )
  })

  it('draws shoulderDown on both the front and the back', () => {
    render(<ThobDiagram values={{ shoulderDown: 8 }} />)

    expect(screen.queryByTestId('value-shoulderF')).toBeTruthy()
    expect(screen.queryByTestId('value-shoulderB')).toBeTruthy()
  })

  it('shows the placeholder for missing values when one is given', () => {
    render(<ThobDiagram values={{}} placeholder="__" />)

    expect(screen.queryByTestId('value-chest')).toBeTruthy()
    expect(screen.queryAllByText('__').length).toBeGreaterThan(0)
  })

  it('shows field labels above values when showLabels is on', () => {
    render(<ThobDiagram values={{ chest: 42 }} showLabels />)

    expect(screen.queryAllByText('Chest').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('42').length).toBeGreaterThan(0)
  })
})

describe('measurement field data', () => {
  it('covers every measurement on the draft', () => {
    // Type and fit live on the draft but outside the diagram catalog: plain
    // selects with no sheet slot, rendered by MeasurementFields itself.
    const drafted = Object.keys(createEmptyMeasurement()).filter(
      (key) =>
        key !== 'loadedFromId' &&
        key !== 'date' &&
        key !== 'type' &&
        key !== 'fit',
    )

    expect(MEASUREMENT_FIELDS.map((field) => field.name).sort()).toEqual(
      drafted.sort(),
    )
  })

  it('has a draft field for every diagram slot', () => {
    const drafted = new Set(Object.keys(createEmptyMeasurement()))
    for (const slot of THOBE_VALUE_SLOTS) {
      expect([slot.key, drafted.has(slot.key)]).toEqual([slot.key, true])
    }
  })

  it('lists every slot key once in THOBE_FIELDS', () => {
    const keys = THOBE_VALUE_SLOTS.map((slot) => slot.key)
    expect(THOBE_FIELDS.map((f) => f.key).sort()).toEqual(
      [...new Set(keys)].sort(),
    )
  })
})
