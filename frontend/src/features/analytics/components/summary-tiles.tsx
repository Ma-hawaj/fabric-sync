import { StatTile } from './stat-tile'
import { deltaPercent } from '../lib/analytics'
import { formatCount, formatMoney, formatPercent } from '../lib/format'
import type { FinancialSummary } from '../lib/analytics'

interface SummaryTilesProps {
  current: FinancialSummary
  /** The same figures for the preceding window; null for 'All time'. */
  previous: FinancialSummary | null
  /** e.g. "vs previous 90 days" — omitted when there is no comparison. */
  comparisonLabel?: string
}

/**
 * The headline row. Each of these is a single current value, so it is a stat
 * tile rather than a one-bar chart. Exactly one is the hero figure — the
 * number the page leads with.
 */
export function SummaryTiles({
  current,
  previous,
  comparisonLabel,
}: SummaryTilesProps) {
  const collectionRate = current.invoiced
    ? (current.collected / current.invoiced) * 100
    : 0

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      <StatTile
        hero
        className="sm:col-span-2"
        label="Invoiced"
        value={formatMoney(current.invoiced)}
        delta={deltaPercent(current.invoiced, previous?.invoiced ?? null)}
        deltaLabel={comparisonLabel}
        hint={`${formatCount(current.invoiceCount)} invoices, VAT included`}
      />
      <StatTile
        label="Collected"
        value={formatMoney(current.collected)}
        delta={deltaPercent(current.collected, previous?.collected ?? null)}
        deltaLabel={comparisonLabel}
        hint={`${formatPercent(collectionRate)} of invoiced`}
      />
      <StatTile
        label="Outstanding"
        value={formatMoney(current.outstanding)}
        lowerIsBetter
        delta={deltaPercent(current.outstanding, previous?.outstanding ?? null)}
        deltaLabel={comparisonLabel}
        hint="Still to collect"
      />
      <StatTile
        label="Orders placed"
        value={formatCount(current.orderCount)}
        delta={deltaPercent(current.orderCount, previous?.orderCount ?? null)}
        deltaLabel={comparisonLabel}
        hint="Tailoring lines"
      />
      <StatTile
        label="Average order"
        value={formatMoney(current.averageOrderValue)}
        delta={deltaPercent(
          current.averageOrderValue,
          previous?.averageOrderValue ?? null,
        )}
        deltaLabel={comparisonLabel}
        hint="Per tailoring line"
      />
    </div>
  )
}
