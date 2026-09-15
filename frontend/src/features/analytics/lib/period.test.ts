import { describe, expect, it } from 'vitest'
import { bucketKey, buildBuckets, periodRange, withinRange } from './period'

const NOW = new Date('2026-08-14T09:30:00Z')

describe('periodRange', () => {
  it('makes the last 30 days a 30-day window ending after today', () => {
    const range = periodRange('30d', NOW)

    expect(range.start?.toISOString()).toBe('2026-07-16T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-08-15T00:00:00.000Z')
    expect(range.bucket).toBe('day')
  })

  it('starts the 12-month window at the first of the month, 11 months back', () => {
    const range = periodRange('12m', NOW)

    expect(range.start?.toISOString()).toBe('2025-09-01T00:00:00.000Z')
    expect(range.bucket).toBe('month')
    expect(range.previous?.start.toISOString()).toBe('2024-09-01T00:00:00.000Z')
  })

  it('gives all time no lower bound and nothing to compare against', () => {
    const range = periodRange('all', NOW)

    expect(range.start).toBeNull()
    expect(range.previous).toBeNull()
    expect(range.bucket).toBe('month')
  })

  it('puts the previous window immediately before the current one', () => {
    const range = periodRange('90d', NOW)

    expect(range.previous?.end).toEqual(range.start)
    // 90 days of its own, ending where the current window opens.
    expect(range.previous?.start.toISOString()).toBe('2026-02-16T00:00:00.000Z')
  })
})

describe('buildBuckets', () => {
  it('covers the whole range, empty stretches included', () => {
    const buckets = buildBuckets(periodRange('30d', NOW), null)

    expect(buckets).toHaveLength(30)
    expect(buckets[0].key).toBe('2026-07-16')
    expect(buckets[29].key).toBe('2026-08-14')
  })

  it('anchors weekly buckets to the start of the range, not a weekday', () => {
    const buckets = buildBuckets(periodRange('90d', NOW), null)

    expect(buckets[0].key).toBe('2026-05-17')
    expect(buckets[1].key).toBe('2026-05-24')
    expect(buckets).toHaveLength(13)
  })

  it('labels monthly buckets with the month and year', () => {
    const buckets = buildBuckets(periodRange('12m', NOW), null)

    expect(buckets).toHaveLength(12)
    expect(buckets[0].label).toBe('Sep 2025')
    expect(buckets[11].label).toBe('Aug 2026')
  })

  it('falls back to the earliest data point for all time', () => {
    const buckets = buildBuckets(
      periodRange('all', NOW),
      new Date('2026-06-20T00:00:00Z'),
    )

    expect(buckets[0].key).toBe('2026-06-01')
    expect(buckets).toHaveLength(3)
  })

  it('has nothing to draw for all time with no data at all', () => {
    expect(buildBuckets(periodRange('all', NOW), null)).toEqual([])
  })
})

describe('bucketKey', () => {
  const anchor = new Date('2026-05-17T00:00:00Z')

  it('rounds a date down to its week within the range', () => {
    expect(bucketKey(new Date('2026-05-23T18:00:00Z'), 'week', anchor)).toBe(
      '2026-05-17',
    )
    expect(bucketKey(new Date('2026-05-24T00:00:00Z'), 'week', anchor)).toBe(
      '2026-05-24',
    )
  })

  it('rounds a date down to the first of its month', () => {
    expect(bucketKey(new Date('2026-05-23T18:00:00Z'), 'month', anchor)).toBe(
      '2026-05-01',
    )
  })
})

describe('withinRange', () => {
  const bounds = {
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2026-08-01T00:00:00Z'),
  }

  it('includes the first moment and excludes the last', () => {
    expect(withinRange(new Date('2026-07-01T00:00:00Z'), bounds)).toBe(true)
    expect(withinRange(new Date('2026-08-01T00:00:00Z'), bounds)).toBe(false)
  })

  it('treats a null start as unbounded', () => {
    expect(
      withinRange(new Date('2020-01-01T00:00:00Z'), {
        start: null,
        end: bounds.end,
      }),
    ).toBe(true)
  })
})
