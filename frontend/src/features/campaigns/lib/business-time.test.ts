import { describe, expect, it } from 'vitest'
import { businessTime, fromBusinessTime } from './business-time'

describe('campaign business times', () => {
  it('uses the business zone independently of the browser zone', () => {
    expect(fromBusinessTime('2026-12-01T12:30', 'Asia/Bahrain')).toBe(
      '2026-12-01T09:30:00.000Z',
    )
    expect(businessTime('2026-12-01T09:30:00.000Z', 'Asia/Bahrain')).toBe(
      '2026-12-01T12:30',
    )
  })
  it('preserves seconds on consent records', () => {
    expect(fromBusinessTime('2026-12-01T12:30:45', 'Asia/Bahrain')).toBe(
      '2026-12-01T09:30:45.000Z',
    )
    expect(businessTime('2026-12-01T09:30:45Z', 'Asia/Bahrain', true)).toBe(
      '2026-12-01T12:30:45',
    )
  })
  it('rejects nonexistent dates and ambiguous daylight-saving times', () => {
    expect(() => fromBusinessTime('2026-02-31T12:00', 'Asia/Bahrain')).toThrow()
    expect(() =>
      fromBusinessTime('2026-03-08T02:30', 'America/New_York'),
    ).toThrow()
    expect(() =>
      fromBusinessTime('2026-11-01T01:30', 'America/New_York'),
    ).toThrow()
  })
})
