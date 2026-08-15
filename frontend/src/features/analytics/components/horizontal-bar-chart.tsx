import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'

// Ranked magnitude, which is what most of this page's cuts are: value by
// material, by branch, orders waiting per stage. One series, one hue — a
// per-bar colour ramp would encode bar length twice and burn the only free
// channel. The value rides the bar end as a direct label, so nothing on this
// chart is reachable only through a tooltip.
//
// Callers flatten their own rows into `BarRow` rather than the chart reaching
// into arbitrary shapes: one set of data keys keeps the axes, the label and
// the tooltip in step.

export interface BarRow {
  name: string
  value: number
  /** Optional second tooltip line: counts, units, sample sizes. */
  detail?: string
}

interface HorizontalBarChartProps {
  data: BarRow[]
  /** What the measure is called, in the tooltip. */
  seriesLabel: string
  formatValue: (value: number) => string
  /** Series slot. Charts on this page use slot 1 unless they carry two series. */
  color?: string
  categoryWidth?: number
}

const ROW_HEIGHT = 34
const CHART_PADDING = 28
const LABEL_CHAR_WIDTH = 6.2
const MAX_CATEGORY_CHARS = 20

export function HorizontalBarChart({
  data,
  seriesLabel,
  formatValue,
  color = 'var(--chart-1)',
  categoryWidth = 132,
}: HorizontalBarChartProps) {
  const config = {
    value: { label: seriesLabel, color },
  } satisfies ChartConfig

  // Room for the longest bar-end label, measured rather than guessed: a
  // three-decimal currency amount is far wider than a count, and a clipped
  // direct label would leave the value reachable only through the tooltip.
  const longestLabel = data.reduce(
    (longest, row) => Math.max(longest, formatValue(row.value).length),
    0,
  )
  const rightMargin = Math.ceil(longestLabel * LABEL_CHAR_WIDTH) + 16

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: data.length * ROW_HEIGHT + CHART_PADDING }}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ left: 0, right: rightMargin, top: 4, bottom: 4 }}
      >
        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          axisLine={false}
          width={categoryWidth}
          tickMargin={8}
          tickFormatter={(value: string) =>
            value.length > MAX_CATEGORY_CHARS
              ? `${value.slice(0, MAX_CATEGORY_CHARS - 1)}…`
              : value
          }
        />
        <XAxis dataKey="value" type="number" hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(value, _name, _item, _index, payload) => {
                // Recharts types the row it hands back as the union of every
                // payload shape it can produce; here it is always the BarRow
                // the caller passed in as `data`.
                const row = payload as unknown as BarRow
                return (
                  <div className="grid gap-0.5">
                    <span className="font-medium text-foreground">
                      {formatValue(Number(value))}
                    </span>
                    {row.detail ? (
                      <span className="text-muted-foreground">
                        {row.detail}
                      </span>
                    ) : null}
                  </div>
                )
              }}
            />
          }
        />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          radius={[0, 4, 4, 0]}
          maxBarSize={24}
        >
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            className="fill-muted-foreground"
            fontSize={11}
            formatter={(value) => formatValue(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
