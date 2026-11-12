import { describe, expect, it } from 'vitest'
import { missedClosingSchema } from './missed-closing-schema'

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

describe('immutable skipped days', () => {
  it('requires a reason and acknowledgement when skipping a missed closing', () => {
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
