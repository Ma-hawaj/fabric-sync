import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { formatMoney, formatMoneyAxis } from '../lib/format'
import type { TrendPoint } from '../lib/analytics'

// Billed against banked, on one axis and in one currency — the gap between
// the lines is the money still owed, which is the whole point of drawing them
// together.
//
// No end labels: the two lines meet whenever a period is fully settled, and
// labels nudged apart at a shared endpoint detach from their lines. The
// legend carries identity and the crosshair tooltip carries the values.
const chartConfig = {
  invoiced: { label: 'Invoiced', color: 'var(--chart-1)' },
  collected: { label: 'Collected', color: 'var(--chart-2)' },
} satisfies ChartConfig

export function RevenueTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[280px] w-full"
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ left: 4, right: 28, top: 8, bottom: 4 }}
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
          width={72}
          tickFormatter={(value: number) => formatMoneyAxis(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              formatter={(value, name) => (
                <div className="flex flex-1 items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {chartConfig[name as keyof typeof chartConfig].label}
                  </span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatMoney(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        {/* itemSorter defaults to alphabetical, which would put Collected
            before Invoiced and read against the title. */}
        <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
        <Line
          dataKey="invoiced"
          type="monotone"
          stroke="var(--color-invoiced)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2 }}
        />
        <Line
          dataKey="collected"
          type="monotone"
          stroke="var(--color-collected)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2 }}
        />
      </LineChart>
    </ChartContainer>
  )
}
