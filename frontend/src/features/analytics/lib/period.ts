// The one filter the analytics page has: which slice of time every chart on
// it is scoped to. Kept apart from the derivations in analytics.ts so the
// bucket arithmetic can be tested on its own.
//
// Every date on this page is treated as UTC. Invoice and order dates arrive
// as `YYYY-MM-DD` strings, which parse to UTC midnight — bucketing them in
// local time would push a day's work into the neighbouring bucket for anyone
// west of Greenwich.

export type AnalyticsPeriod = '30d' | '90d' | '12m' | 'all'

export const ANALYTICS_PERIODS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
] as const satisfies ReadonlyArray<{ value: AnalyticsPeriod; label: string }>

export const DEFAULT_PERIOD: AnalyticsPeriod = '90d'

/** How wide one point on a trend line is. Picked from the period's length. */
export type BucketSize = 'day' | 'week' | 'month'

export interface PeriodRange {
  period: AnalyticsPeriod
  /** Inclusive lower bound; null for 'all', which has no lower bound. */
  start: Date | null
  /** Exclusive upper bound — midnight after today, so today counts. */
  end: Date
  bucket: BucketSize
  /**
   * The equally long window immediately before `start`, for period-on-period
   * deltas. Null for 'all', which has nothing to compare against.
   */
  previous: { start: Date; end: Date } | null
}

export interface TimeBucket {
  key: string
  label: string
  /** Inclusive lower bound of the bucket. */
  start: Date
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/** Midnight UTC on the day `date` falls in. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  )
}

export function periodRange(period: AnalyticsPeriod, now: Date): PeriodRange {
  const end = new Date(startOfUtcDay(now).getTime() + DAY_MS)

  if (period === 'all') {
    return { period, start: null, end, bucket: 'month', previous: null }
  }

  const start =
    period === '12m'
      ? addUtcMonths(startOfUtcMonth(now), -11)
      : new Date(
          startOfUtcDay(now).getTime() - (period === '30d' ? 29 : 89) * DAY_MS,
        )

  const bucket: BucketSize =
    period === '30d' ? 'day' : period === '90d' ? 'week' : 'month'

  // A same-length window ending where this one starts. For months that means
  // the twelve months before, not a fixed number of days.
  const previous =
    period === '12m'
      ? { start: addUtcMonths(start, -12), end: start }
      : {
          start: new Date(start.getTime() - (end.getTime() - start.getTime())),
          end: start,
        }

  return { period, start, end, bucket, previous }
}

const dayLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

const monthLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Which bucket a date belongs to, or null when it falls outside the range.
 * `anchor` is the range's first bucket start — weeks are counted from there
 * rather than from a calendar weekday, so the newest bucket is always a full
 * week ending today.
 */
export function bucketKey(
  date: Date,
  bucket: BucketSize,
  anchor: Date,
): string {
  if (bucket === 'month') {
    return isoDay(startOfUtcMonth(date))
  }
  if (bucket === 'day') {
    return isoDay(startOfUtcDay(date))
  }
  const weeks = Math.floor(
    (startOfUtcDay(date).getTime() - anchor.getTime()) / WEEK_MS,
  )
  return isoDay(new Date(anchor.getTime() + weeks * WEEK_MS))
}

function bucketLabel(start: Date, bucket: BucketSize): string {
  return bucket === 'month' ? monthLabel.format(start) : dayLabel.format(start)
}

/**
 * Every bucket in the range, including the empty ones — a trend line with the
 * quiet weeks left out would misstate the shape of the business.
 *
 * `earliest` is the oldest date in the data, used only by 'all', which has no
 * start of its own. With no data at all the result is empty.
 */
export function buildBuckets(
  range: PeriodRange,
  earliest: Date | null,
): TimeBucket[] {
  const anchor = range.start ?? (earliest ? startOfUtcDay(earliest) : null)
  if (!anchor) return []

  const buckets: TimeBucket[] = []
  const first =
    range.bucket === 'month' ? startOfUtcMonth(anchor) : startOfUtcDay(anchor)

  // Capped so a bad clock or a stray far-past date can't spin here forever.
  const limit = 400
  let cursor = first
  while (cursor < range.end && buckets.length < limit) {
    buckets.push({
      key: isoDay(cursor),
      label: bucketLabel(cursor, range.bucket),
      start: cursor,
    })
    cursor =
      range.bucket === 'month'
        ? addUtcMonths(cursor, 1)
        : new Date(
            cursor.getTime() + (range.bucket === 'week' ? WEEK_MS : DAY_MS),
          )
  }

  return buckets
}

/** True when `date` is inside `[start, end)`. A null start means unbounded. */
export function withinRange(
  date: Date,
  bounds: { start: Date | null; end: Date },
): boolean {
  if (bounds.start && date < bounds.start) return false
  return date < bounds.end
}
