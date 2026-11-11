import { describe, expect, it } from 'vitest'
import {
  missedClosingSchema,
  nextBusinessDate,
  rolloutSchema,
} from './rollout-schema'

function expectIssue(
  result: {
    success: boolean
    error?: { issues: { path: PropertyKey[]; message: string }[] }
  },
  path: string,
  message: RegExp,
) {
  expect(result.success).toBe(false)
  expect(result.error?.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: [path],
        message: expect.stringMatching(message),
      }),
    ]),
  )
}

describe('rollout and immutable missed closings', () => {
  it('defaults to the next calendar day across month and year boundaries', () => {
    expect(nextBusinessDate('2026-12-31')).toBe('2027-01-01')
    expect(nextBusinessDate('2028-02-28')).toBe('2028-02-29')
  })
  it('rejects backdating rollout and unexplained resolutions', () => {
    expectIssue(
      rolloutSchema('2026-11-10').safeParse({ startsOn: '2026-11-09' }),
      'startsOn',
      /today or a future date/i,
    )
    expect(
      rolloutSchema('2026-11-10').safeParse({ startsOn: '2026-11-11' }).success,
    ).toBe(true)
    expectIssue(
      missedClosingSchema.safeParse({ reason: ' ', acknowledged: true }),
      'reason',
      /explain.*missed/i,
    )
    expectIssue(
      missedClosingSchema.safeParse({
        reason: 'Missed count',
        acknowledged: false,
      }),
      'acknowledged',
      /confirm.*unreconciled.*read-only/i,
    )
  })
})
