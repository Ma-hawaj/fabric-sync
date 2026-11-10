import { describe, expect, it } from 'vitest'
import {
  missedClosingSchema,
  nextBusinessDate,
  rolloutSchema,
} from './rollout-schema'

describe('rollout and immutable missed closings', () => {
  it('defaults to the next calendar day across month and year boundaries', () => {
    expect(nextBusinessDate('2026-12-31')).toBe('2027-01-01')
    expect(nextBusinessDate('2028-02-28')).toBe('2028-02-29')
  })
  it('rejects backdating rollout and unexplained resolutions', () => {
    expect(
      rolloutSchema('2026-11-10').safeParse({ startsOn: '2026-11-09' }).success,
    ).toBe(false)
    expect(
      rolloutSchema('2026-11-10').safeParse({ startsOn: '2026-11-11' }).success,
    ).toBe(true)
    expect(
      missedClosingSchema.safeParse({ reason: ' ', acknowledged: true })
        .success,
    ).toBe(false)
    expect(
      missedClosingSchema.safeParse({
        reason: 'Missed count',
        acknowledged: false,
      }).success,
    ).toBe(false)
  })
})
