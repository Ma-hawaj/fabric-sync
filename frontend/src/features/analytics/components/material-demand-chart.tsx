import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { formatMetres } from '../lib/format'
import type { MaterialDemand } from '../lib/analytics'

// Both series are metres, so they share one axis honestly — a material whose
// "used" bar towers over its "on hand" bar is the one about to run out. Two
// different measures would have needed two charts.
const chartConfig = {
  used: { label: 'Used in period', color: 'var(--chart-1)' },
  stock: { label: 'On hand now', color: 'var(--chart-2)' },
} satisfies ChartConfig

export function MaterialDemandChart({ data }: { data: MaterialDemand[] }) {
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto w-full"
      style={{ height: data.length * 52 + 56 }}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ left: 0, right: 16, top: 4, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} />
        <YAxis
          dataKey="material"
          type="category"
          tickLine={false}
          axisLine={false}
          width={132}
          tickMargin={8}
          tickFormatter={(value: string) =>
            value.length > 20 ? `${value.slice(0, 19)}…` : value
          }
        />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: number) => formatMetres(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex flex-1 items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {chartConfig[name as keyof typeof chartConfig].label}
                  </span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatMetres(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
        <Bar
          dataKey="used"
          fill="var(--color-used)"
          radius={[0, 4, 4, 0]}
          maxBarSize={16}
        />
        <Bar
          dataKey="stock"
          fill="var(--color-stock)"
          radius={[0, 4, 4, 0]}
          maxBarSize={16}
        />
      </BarChart>
    </ChartContainer>
  )
}
