import * as React from 'react'
import { useInventory } from '@/features/inventory/hooks/use-inventory'
import { useInvoices } from '@/features/invoices/hooks/use-invoices'
import { useOrders } from '@/features/orders/hooks/use-orders'
import { FinancialSection } from './components/financial-section'
import { MaterialsSection } from './components/materials-section'
import { PeriodFilter } from './components/period-filter'
import { ProductionSection } from './components/production-section'
import { SummaryTiles } from './components/summary-tiles'
import { useAnalyticsPeriod } from './hooks/use-analytics-period'
import {
  averageStageDuration,
  collectedByPaymentMethod,
  completedOrderCount,
  earliestDate,
  financialSummary,
  materialDemandVsStock,
  orderValueByBranch,
  repairBreakdown,
  revenueTrend,
  sliceFor,
  throughput,
  topMaterialsByValue,
  workInProgressByStage,
} from './lib/analytics'
import { ANALYTICS_PERIODS, buildBuckets } from './lib/period'

// The page reads from the same three queries the Orders, Invoices and
// Inventory pages already use — there is no analytics endpoint, and adding
// one would mean a second definition of every figure below. Everything on
// screen is derived in lib/analytics.ts from those lists.

const COMPARISON_LABELS: Record<string, string> = {
  '30d': 'vs previous 30 days',
  '90d': 'vs previous 90 days',
  '12m': 'vs previous 12 months',
}

export function AnalyticsPage() {
  const { period, setPeriod, range } = useAnalyticsPeriod()
  const orders = useOrders()
  const invoices = useInvoices()
  const materials = useInventory()

  const allOrders = React.useMemo(() => orders.data ?? [], [orders.data])
  const allInvoices = React.useMemo(() => invoices.data ?? [], [invoices.data])
  const allMaterials = React.useMemo(
    () => materials.data ?? [],
    [materials.data],
  )

  const isLoading =
    orders.isPending || invoices.isPending || materials.isPending
  const isFetching =
    orders.isFetching || invoices.isFetching || materials.isFetching

  const analytics = React.useMemo(() => {
    const current = sliceFor(allOrders, allInvoices, range)
    const previous = range.previous
      ? sliceFor(allOrders, allInvoices, range.previous)
      : null

    const buckets = buildBuckets(range, earliestDate(allInvoices, allOrders))

    return {
      summary: financialSummary(current.invoices, current.orders),
      previousSummary: previous
        ? financialSummary(previous.invoices, previous.orders)
        : null,
      trend: revenueTrend(current.invoices, buckets, range.bucket),
      paymentMethods: collectedByPaymentMethod(current.invoices),
      branches: orderValueByBranch(current.orders),
      topMaterials: topMaterialsByValue(current.orders),
      demand: materialDemandVsStock(current.orders, allMaterials),
      stageLoad: workInProgressByStage(current.orders),
      stageDurations: averageStageDuration(current.orders),
      throughput: throughput(current.orders, buckets, range.bucket),
      repairs: repairBreakdown(current.orders),
      completedOrders: completedOrderCount(current.orders),
    }
  }, [allOrders, allInvoices, allMaterials, range])

  const periodLabel =
    ANALYTICS_PERIODS.find((option) => option.value === period)?.label ?? ''

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Money, production and materials for {periodLabel.toLowerCase()}.
          </p>
        </div>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Loading analytics...
        </div>
      ) : (
        <>
          <SummaryTiles
            current={analytics.summary}
            previous={analytics.previousSummary}
            comparisonLabel={COMPARISON_LABELS[period]}
          />
          <FinancialSection
            trend={analytics.trend}
            paymentMethods={analytics.paymentMethods}
            branches={analytics.branches}
            isFetching={isFetching}
          />
          <ProductionSection
            stageLoad={analytics.stageLoad}
            stageDurations={analytics.stageDurations}
            throughput={analytics.throughput}
            repairs={analytics.repairs}
            completedOrders={analytics.completedOrders}
            openOrders={
              analytics.summary.orderCount - analytics.completedOrders
            }
            isFetching={isFetching}
          />
          <MaterialsSection
            topMaterials={analytics.topMaterials}
            demand={analytics.demand}
            isFetching={isFetching}
          />
        </>
      )}
    </div>
  )
}
