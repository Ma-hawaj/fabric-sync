import { describe, expect, it } from 'vitest'
import { parseFilterDate, serializeFilterDate } from './filter-date'

describe('calendar filter dates', () => {
  it('sends the selected local calendar day without converting through UTC', () => {
    const selected = new Date(2026, 9, 22)
    expect(serializeFilterDate(selected)).toBe('2026-10-22')
    const restored = parseFilterDate('2026-10-22')!
    expect([
      restored.getFullYear(),
      restored.getMonth(),
      restored.getDate(),
    ]).toEqual([2026, 9, 22])
    expect(restored.getHours()).toBe(0)
  })

  it('keeps old timestamp values readable', () => {
    const selected = new Date(2026, 9, 22)
    expect(parseFilterDate(selected.getTime())?.getTime()).toBe(
      selected.getTime(),
    )
    expect(parseFilterDate(String(selected.getTime()))?.getTime()).toBe(
      selected.getTime(),
    )
  })

  it('rejects malformed dates and preserves blank range bounds', () => {
    for (const value of [undefined, '', 'not-a-date', '2026-02-31']) {
      expect(parseFilterDate(value)).toBeUndefined()
    }
    expect(serializeFilterDate(undefined)).toBe('')
    expect(serializeFilterDate(new Date(Number.NaN))).toBe('')
  })
})
