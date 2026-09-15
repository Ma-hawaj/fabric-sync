import { ChartCard } from './chart-card'
import { HorizontalBarChart } from './horizontal-bar-chart'
import { MaterialDemandChart } from './material-demand-chart'
import { formatCount, formatMetres, formatMoney } from '../lib/format'
import type { MaterialDemand, MaterialTotal } from '../lib/analytics'

interface MaterialsSectionProps {
  topMaterials: MaterialTotal[]
  demand: MaterialDemand[]
  isFetching: boolean
}

export function MaterialsSection({
  topMaterials,
  demand,
  isFetching,
}: MaterialsSectionProps) {
  return (
    <section className="grid items-start gap-4 lg:grid-cols-2">
      <h2 className="text-lg font-semibold tracking-tight lg:col-span-2">
        Materials
      </h2>

      <ChartCard
        title="Top materials by order value"
        description="Which fabrics earn the most. Everything past the top eight is folded into one row."
        isEmpty={topMaterials.length === 0}
        isFetching={isFetching}
      >
        <HorizontalBarChart
          data={topMaterials.map((entry) => ({
            name: entry.material,
            value: entry.value,
            detail: `${formatCount(entry.orders)} orders · ${formatMetres(entry.metres)}`,
          }))}
          seriesLabel="Order value"
          formatValue={formatMoney}
        />
      </ChartCard>

      <ChartCard
        title="Demand vs stock on hand"
        description="Metres consumed in the period against metres in stock right now, across every location. Stock is current, not historical."
        isEmpty={demand.length === 0}
        isFetching={isFetching}
      >
        <MaterialDemandChart data={demand} />
      </ChartCard>
    </section>
  )
}
