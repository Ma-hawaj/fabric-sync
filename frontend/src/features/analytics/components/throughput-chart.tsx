import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { formatCount } from '../lib/format'
import type { ThroughputPoint } from '../lib/analytics'

// Work in against work out. Both series are counts of orders on one axis, so
// the bars are directly comparable: bars that keep landing taller on the left
// mean the queue is growing.
const chartConfig = {
  placed: { label: 'Placed', color: 'var(--chart-1)' },
  completed: { label: 'Completed', color: 'var(--chart-2)' },
} satisfies ChartConfig

export function ThroughputChart({ data }: { data: ThroughputPoint[] }) {
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[260px] w-full"
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ left: 4, right: 12, top: 8, bottom: 4 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={36}
          allowDecimals={false}
          tickFormatter={(value: number) => formatCount(value)}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
        <Bar
          dataKey="placed"
          fill="var(--color-placed)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
        />
        <Bar
          dataKey="completed"
          fill="var(--color-completed)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
        />
      </BarChart>
    </ChartContainer>
  )
}
