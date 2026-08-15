import { parseAsStringLiteral, useQueryState } from 'nuqs'
import * as React from 'react'
import { ANALYTICS_PERIODS, DEFAULT_PERIOD, periodRange } from '../lib/period'
import type { AnalyticsPeriod, PeriodRange } from '../lib/period'

const PERIOD_VALUES = ANALYTICS_PERIODS.map(
  (option) => option.value,
) as unknown as readonly [AnalyticsPeriod, ...AnalyticsPeriod[]]

const periodParser = parseAsStringLiteral(PERIOD_VALUES)
  .withDefault(DEFAULT_PERIOD)
  .withOptions({ clearOnDefault: true })

/**
 * The page's single filter, in the URL like every other list filter in the
 * app — so a slice worth talking about can be linked to.
 *
 * `now` is resolved once per mount rather than per render: a range that moves
 * under the charts would make every derivation below it recompute on any
 * unrelated state change.
 */
export function useAnalyticsPeriod(): {
  period: AnalyticsPeriod
  setPeriod: (period: AnalyticsPeriod) => void
  range: PeriodRange
} {
  const [period, setPeriod] = useQueryState('period', periodParser)
  const [now] = React.useState(() => new Date())

  const range = React.useMemo(() => periodRange(period, now), [period, now])

  return {
    period,
    setPeriod: (next) => void setPeriod(next),
    range,
  }
}
