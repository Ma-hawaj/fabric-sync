import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadOnlyMeasurement } from './read-only-measurement'
import type { Measurement } from '../types/customers'

function blankMeasurement(): Measurement {
  return {
    id: 'm1',
    customerId: 'c1',
    date: new Date('2026-07-30'),
  }
}

describe('ReadOnlyMeasurement', () => {
  it('shows the no-measurements state when every field is blank', () => {
    render(<ReadOnlyMeasurement measurement={blankMeasurement()} />)

    expect(
      screen.queryByText('No measurements on record for this garment.'),
    ).toBeTruthy()
  })

  it('ignores null measurement values from the API', () => {
    // The backend serializes unset Option fields as null, so a snapshot with
    // nothing recorded arrives as all-null rather than all-missing. It must
    // land on the empty state, not on blank rows.
    const measurement = {
      ...blankMeasurement(),
      lengthFl: null,
      lengthBl: null,
      chest: null,
      waist: null,
      sidePocket: null,
    } as unknown as Measurement

    render(<ReadOnlyMeasurement measurement={measurement} />)

    expect(
      screen.queryByText('No measurements on record for this garment.'),
    ).toBeTruthy()
  })

  it('lists recorded values and skips the blank fields', () => {
    render(
      <ReadOnlyMeasurement
        measurement={{
          ...blankMeasurement(),
          lengthFl: 120,
          sidePocket: 'Both',
        }}
      />,
    )

    expect(screen.queryByText('Length (Front)')).toBeTruthy()
    expect(screen.queryByText('Side Pocket')).toBeTruthy()
    expect(screen.queryByText('Chest')).toBeNull()
  })
})
