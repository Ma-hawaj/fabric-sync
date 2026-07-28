import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThobDiagram } from './thob-diagram'
import {
  MEASUREMENT_FIELDS,
  RESTING_MARKER_FIELDS,
} from '../data/measurement-fields'
import { THOB_HEIGHT, THOB_WIDTH } from '../data/thob-sketch'
import { createEmptyMeasurement } from '../types/measurement-form'

describe('ThobDiagram', () => {
  it('shows the resting callouts when no field is active', () => {
    render(<ThobDiagram />)

    for (const name of RESTING_MARKER_FIELDS) {
      expect(screen.queryByTestId(`callout-${name}`)).toBeTruthy()
    }
    expect(screen.queryByTestId('callout-waist')).toBeNull()
  })

  it('shows only the active field, labelled with its value', () => {
    render(<ThobDiagram activeField="waist" values={{ waist: 96 }} />)

    expect(screen.queryByTestId('callout-waist')).toBeTruthy()
    expect(screen.queryByTestId('callout-chest')).toBeNull()
    expect(screen.queryByText('Waist · 96 cm')).toBeTruthy()
  })

  it('labels a non-numeric field without a unit', () => {
    render(
      <ThobDiagram activeField="cuffling" values={{ cuffling: 'Cufflink' }} />,
    )

    expect(screen.queryByText('Cuffling · Cufflink')).toBeTruthy()
  })

  it('falls back to the label alone when the value is blank', () => {
    render(<ThobDiagram activeField="waist" values={{ waist: '' }} />)

    expect(screen.queryByText('Waist')).toBeTruthy()
  })

  it('falls back to the resting callouts for an unknown field name', () => {
    render(<ThobDiagram activeField="notAMeasurement" />)

    expect(screen.queryByTestId('callout-chest')).toBeTruthy()
  })

  it('reports the clicked field so the page can focus its input', () => {
    const onSelectField = vi.fn()
    render(<ThobDiagram activeField="hips" onSelectField={onSelectField} />)

    fireEvent.click(screen.getByTestId('callout-hips'))

    expect(onSelectField).toHaveBeenCalledWith('hips')
  })

  it('keeps a long callout label inside the drawing, margins included', () => {
    // The front-length marker is parked against the left edge, so its chip
    // has to slide inwards once a value widens it.
    render(<ThobDiagram activeField="lengthFl" values={{ lengthFl: 148.5 }} />)

    const chip = screen
      .getByTestId('callout-lengthFl')
      .querySelector('rect') as SVGRectElement
    const x = Number(chip.getAttribute('x'))
    const width = Number(chip.getAttribute('width'))

    expect(x).toBeGreaterThanOrEqual(0)
    expect(x + width).toBeLessThanOrEqual(THOB_WIDTH)
  })
})

describe('measurement field data', () => {
  it('covers every measurement on the draft', () => {
    const drafted = Object.keys(createEmptyMeasurement()).filter(
      (key) => key !== 'loadedFromId' && key !== 'date',
    )

    expect(MEASUREMENT_FIELDS.map((field) => field.name).sort()).toEqual(
      drafted.sort(),
    )
  })

  it('anchors every callout inside the sketch', () => {
    for (const { name, marker } of MEASUREMENT_FIELDS) {
      expect([
        name,
        marker.label.x >= 0 && marker.label.x <= THOB_WIDTH,
      ]).toEqual([name, true])
      expect([
        name,
        marker.label.y >= 0 && marker.label.y <= THOB_HEIGHT,
      ]).toEqual([name, true])
    }
  })
})
