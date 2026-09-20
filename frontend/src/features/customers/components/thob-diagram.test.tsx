import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThobDiagram, layoutCaptions } from './thob-diagram'
import {
  MEASUREMENT_FIELDS,
  RESTING_MARKER_FIELDS,
  fieldsInView,
} from '../data/measurement-fields'
import { THOB_HEIGHT, THOB_WIDTH } from '../data/thob-sketch'
import { createEmptyMeasurement } from '../types/measurement-form'

describe('ThobDiagram', () => {
  it('shows only the resting callouts when no field is active', () => {
    render(<ThobDiagram />)

    for (const name of RESTING_MARKER_FIELDS) {
      expect(screen.queryByTestId(`callout-${name}`)).toBeTruthy()
    }
    expect(screen.queryByTestId('callout-waist')).toBeNull()
  })

  it('hides the front placket buttons on the back view', () => {
    const { container } = render(<ThobDiagram view="front" />)
    expect(container.querySelectorAll('circle')).toHaveLength(6)
  })

  it('keeps sleeve buttons but no placket buttons on the back view', () => {
    const { container } = render(<ThobDiagram view="back" />)
    expect(container.querySelectorAll('circle')).toHaveLength(2)
  })

  it('shows only the active field, labelled with its value', () => {
    render(<ThobDiagram activeField="waist" values={{ waist: 96 }} />)

    expect(screen.queryByTestId('callout-waist')).toBeTruthy()
    expect(screen.queryByTestId('callout-chest')).toBeNull()
    expect(screen.queryByText('Waist · 96 inch')).toBeTruthy()
  })

  it('labels a non-numeric field without a unit', () => {
    render(
      <ThobDiagram activeField="sidePocket" values={{ sidePocket: 'Both' }} />,
    )

    expect(screen.queryByText('Side Pocket · Both')).toBeTruthy()
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

  it('draws no callouts in template mode when nothing is recorded', () => {
    render(<ThobDiagram view="front" showRecorded />)

    for (const field of fieldsInView('front')) {
      expect(screen.queryByTestId(`callout-${field.name}`)).toBeNull()
    }
    expect(screen.queryByTestId('callout-lengthBl')).toBeNull()
  })

  it('draws template callouts only for recorded fields', () => {
    render(
      <ThobDiagram
        view="front"
        showRecorded
        values={{ lengthFl: 120, waist: 96 }}
      />,
    )

    expect(screen.queryByTestId('callout-lengthFl')).toBeTruthy()
    expect(screen.queryByTestId('callout-waist')).toBeTruthy()
    // Front-view fields the snapshot didn't capture stay off the silhouette.
    expect(screen.queryByTestId('callout-chest')).toBeNull()
    expect(screen.queryByTestId('callout-frantPocketLength')).toBeNull()
    // And no field from the other view renders on the front.
    expect(screen.queryByTestId('callout-lengthBl')).toBeNull()
  })

  it('draws back view template callouts from recorded values', () => {
    render(
      <ThobDiagram
        view="back"
        showRecorded
        values={{ lengthBl: 124, sleeveLength: 60 }}
      />,
    )

    expect(screen.queryByTestId('callout-lengthBl')).toBeTruthy()
    expect(screen.queryByTestId('callout-sleeveLength')).toBeTruthy()
    expect(screen.queryByTestId('callout-neck')).toBeNull()
    expect(screen.queryByTestId('callout-lengthFl')).toBeNull()
  })

  it('labels template callouts with the recorded value', () => {
    render(
      <ThobDiagram
        view="front"
        showRecorded
        values={{ lengthFl: 120, frantPocketLength: 9 }}
      />,
    )
    expect(screen.queryByText('120 inch · Front Length')).toBeTruthy()
    expect(screen.queryByText('9 inch · Front Pocket')).toBeTruthy()
  })

  it('keeps every template caption box from overlapping on both views', () => {
    const values = { lengthFl: 120, waist: 96, chest: 50, lengthBl: 120 }
    for (const view of ['front', 'back'] as const) {
      const captions = layoutCaptions(fieldsInView(view), values)
      const rects = [...captions.values()]
      for (const rect of rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.y).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.w).toBeLessThanOrEqual(THOB_WIDTH)
        expect(rect.y + 20).toBeLessThanOrEqual(THOB_HEIGHT)
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]
          const b = rects[j]
          const clearsX = a.x + a.w <= b.x || b.x + b.w <= a.x
          const clearsY = a.y + 20 <= b.y || b.y + 20 <= a.y
          expect(clearsX || clearsY).toBe(true)
        }
      }
    }
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

  it('assigns every field to a silhouette view, with both populated', () => {
    for (const field of MEASUREMENT_FIELDS) {
      expect(['front', 'back']).toContain(field.view)
    }
    expect(fieldsInView('front')).not.toHaveLength(0)
    expect(fieldsInView('back')).not.toHaveLength(0)
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
