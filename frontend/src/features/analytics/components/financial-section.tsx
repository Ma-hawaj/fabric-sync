import { ChartCard } from './chart-card'
import { HorizontalBarChart } from './horizontal-bar-chart'
import { RevenueTrendChart } from './revenue-trend-chart'
import { formatCount, formatMoney } from '../lib/format'
import type {
  BranchTotal,
  PaymentMethodTotal,
  TrendPoint,
} from '../lib/analytics'

interface FinancialSectionProps {
  trend: TrendPoint[]
  paymentMethods: PaymentMethodTotal[]
  branches: BranchTotal[]
  isFetching: boolean
}

export function FinancialSection({
  trend,
  paymentMethods,
  branches,
  isFetching,
}: FinancialSectionProps) {
  const hasTrend = trend.some(
    (point) => point.invoiced > 0 || point.collected > 0,
  )
  const hasPayments = paymentMethods.some((method) => method.amount > 0)

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <h2 className="text-lg font-semibold tracking-tight lg:col-span-2">
        Financials
      </h2>

      <ChartCard
        className="lg:col-span-2"
        title="Invoiced vs collected"
        description="What was billed against what has actually been paid. The gap between the lines is money still owed."
        isEmpty={!hasTrend}
        isFetching={isFetching}
      >
        <RevenueTrendChart data={trend} />
      </ChartCard>

      <ChartCard
        title="Collected by payment method"
        description="How settled money came in, counting the advance and the final payment separately."
        isEmpty={!hasPayments}
        isFetching={isFetching}
      >
        <HorizontalBarChart
          data={paymentMethods.map((method) => ({
            name: method.method,
            value: method.amount,
          }))}
          seriesLabel="Collected"
          formatValue={formatMoney}
          categoryWidth={96}
        />
      </ChartCard>

      <ChartCard
        title="Order value by branch"
        description="Tailoring lines only, grouped by where the customer collects."
        isEmpty={branches.length === 0}
        isFetching={isFetching}
      >
        <HorizontalBarChart
          data={branches.map((branch) => ({
            name: branch.branch,
            value: branch.value,
            detail: `${formatCount(branch.orders)} orders`,
          }))}
          seriesLabel="Order value"
          formatValue={formatMoney}
        />
      </ChartCard>
    </section>
  )
}
