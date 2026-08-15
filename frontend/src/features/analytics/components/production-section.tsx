import { ChartCard } from './chart-card'
import { HorizontalBarChart } from './horizontal-bar-chart'
import { RepairsCard } from './repairs-card'
import { StatTile } from './stat-tile'
import { ThroughputChart } from './throughput-chart'
import { formatCount, formatDuration, formatPercent } from '../lib/format'
import type {
  RepairBreakdown,
  StageDuration,
  StageLoad,
  ThroughputPoint,
} from '../lib/analytics'

interface ProductionSectionProps {
  stageLoad: StageLoad[]
  stageDurations: StageDuration[]
  throughput: ThroughputPoint[]
  repairs: RepairBreakdown
  completedOrders: number
  openOrders: number
  isFetching: boolean
}

export function ProductionSection({
  stageLoad,
  stageDurations,
  throughput,
  repairs,
  completedOrders,
  openOrders,
  isFetching,
}: ProductionSectionProps) {
  const hasThroughput = throughput.some(
    (point) => point.placed > 0 || point.completed > 0,
  )

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <h2 className="text-lg font-semibold tracking-tight lg:col-span-2">
        Production
      </h2>

      <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
        <StatTile
          label="Orders finished"
          value={formatCount(completedOrders)}
          hint="Every applicable stage recorded"
        />
        <StatTile
          label="Still in production"
          value={formatCount(openOrders)}
          hint="At least one stage outstanding"
        />
        <StatTile
          label="Rework rate"
          value={formatPercent(repairs.reworkRate)}
          lowerIsBetter
          hint={`${formatCount(repairs.outstanding)} repairs still open`}
        />
      </div>

      <ChartCard
        title="Work in progress by stage"
        description="Where unfinished orders are sitting, in checklist order. Finished orders are left out."
        emptyLabel="Nothing in production for this period."
        isEmpty={stageLoad.length === 0}
        isFetching={isFetching}
      >
        <HorizontalBarChart
          data={stageLoad.map((entry) => ({
            name: entry.stage,
            value: entry.orders,
          }))}
          seriesLabel="Orders waiting"
          formatValue={formatCount}
        />
      </ChartCard>

      <ChartCard
        title="Average time per stage"
        description="How long a stage takes once work reaches it. Only stages that were recorded as done count."
        emptyLabel="No stages have been completed in this period yet."
        isEmpty={stageDurations.length === 0}
        isFetching={isFetching}
      >
        <HorizontalBarChart
          data={stageDurations.map((entry) => ({
            name: entry.stage,
            value: entry.hours,
            detail: `over ${formatCount(entry.samples)} orders`,
          }))}
          seriesLabel="Average"
          formatValue={formatDuration}
        />
      </ChartCard>

      <ChartCard
        className="lg:col-span-2"
        title="Orders placed vs completed"
        description="Intake against output. Bars that stay taller on the placed side mean the queue is growing."
        isEmpty={!hasThroughput}
        isFetching={isFetching}
      >
        <ThroughputChart data={throughput} />
      </ChartCard>

      <div className="lg:col-span-2">
        <RepairsCard repairs={repairs} />
      </div>
    </section>
  )
}
