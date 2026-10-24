import { describe, expect, it } from 'vitest'
import { formatMeasurement } from './format-measurement'

describe('formatMeasurement', () => {
  it.each([
    [55.5, '55 ½'],
    [17.25, '17 ¼'],
    [17.75, '17 ¾'],
    [17.125, '17 ⅛'],
    [17.375, '17 ⅜'],
    [17.625, '17 ⅝'],
    [17.875, '17 ⅞'],
    [0.5, '½'],
    [0.125, '⅛'],
    [-17.75, '-17 ¾'],
    [-0.5, '-½'],
    [0, '0'],
    [42, '42'],
    [17.13, '17.13'],
    [17.123, '17.123'],
    [17.999, '17.999'],
    ['12.5×8', '12.5×8'],
    ['No 16x14', 'No 16x14'],
    ['55 ½', '55 ½'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('formats %s as %s', (value, expected) => {
    expect(formatMeasurement(value)).toBe(expected)
  })
})
