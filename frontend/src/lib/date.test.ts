import { describe, expect, it } from 'vitest'
import { localDateString, parseDate } from './date'
import { formatDate } from './format'

describe('local calendar dates', () => {
  it('keeps a date-only API value on its written day', () => {
    expect(parseDate('2026-07-31')).toEqual(new Date(2026, 6, 31))
    expect(formatDate('2026-07-31')).toBe('July 31, 2026')
  })

  it('preserves the moment carried by UTC and explicit-offset timestamps', () => {
    const utc = '2026-07-30T22:30:00Z'
    const offset = '2026-07-31T01:30:00+03:00'
    expect(parseDate(offset).getTime()).toBe(Date.parse(utc))
    expect(parseDate(utc).getTime()).toBe(Date.parse(utc))
    expect(localDateString(parseDate(offset))).toBe(
      localDateString(new Date(utc)),
    )
  })
})
