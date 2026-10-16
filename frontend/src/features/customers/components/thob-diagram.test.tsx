import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('draws shoulderDown on the front and shoulder on the back', () => {
    render(<ThobDiagram values={{ shoulderDown: 8, shoulder: 18 }} />)

    expect(screen.queryByTestId('value-shoulderF')).toBeTruthy()
    expect(screen.queryByTestId('value-shoulderB')).toBeTruthy()
  })

  it('leaves the back shoulder slot empty when only shoulderDown is recorded', () => {
    render(<ThobDiagram values={{ shoulderDown: 8 }} />)

    expect(screen.queryByTestId('value-shoulderF')).toBeTruthy()
    expect(screen.queryByTestId('value-shoulderB')).toBeNull()
  })

  it('draws the yoke circle only when fullBody is recorded', () => {
    // Four front ellipses plus two back cuffs without it.
    const { container, rerender } = render(<ThobDiagram values={{}} />)
    expect(container.querySelectorAll('ellipse')).toHaveLength(6)

    rerender(<ThobDiagram values={{ fullBody: 150 }} />)
    expect(container.querySelectorAll('ellipse')).toHaveLength(7)
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

  it('highlights the active slot and dims the rest', () => {
    render(
      <ThobDiagram values={{ chest: 42, waist: 30 }} activeField="chest" />,
    )

    const active = screen.getByTestId('value-chest')
    expect(active.getAttribute('data-active')).toBe('true')
    expect(active.querySelector('text[font-weight="700"]')).toBeTruthy()
    const idle = screen.getByTestId('value-waist')
    expect(idle.getAttribute('data-active')).toBeNull()
    expect(idle.getAttribute('opacity')).toBe('0.3')
  })

  it('highlights nothing for an unknown field name', () => {
    const { container } = render(
      <ThobDiagram values={{ chest: 42 }} activeField="notAMeasurement" />,
    )

    expect(container.querySelector('[data-active]')).toBeNull()
    expect(screen.getByTestId('value-chest').getAttribute('opacity')).toBeNull()
  })

  it('reports the clicked slot so the page can focus its input', () => {
    const onSelectField = vi.fn()
    render(<ThobDiagram values={{ chest: 42 }} onSelectField={onSelectField} />)

    fireEvent.click(screen.getByTestId('value-chest'))

    expect(onSelectField).toHaveBeenCalledWith('chest')
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
