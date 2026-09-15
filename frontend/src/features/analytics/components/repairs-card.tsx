import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatCount } from '../lib/format'
import type { RepairBreakdown } from '../lib/analytics'

/**
 * Four small counts, so they are read as numbers rather than drawn as bars —
 * a bar chart of 0–4 gives the top row the full width of the card and says
 * nothing the figure doesn't. The open states lead, since those are the ones
 * that still need somebody.
 */
export function RepairsCard({ repairs }: { repairs: RepairBreakdown }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Repairs</CardTitle>
        <CardDescription>
          Garments brought back for rework. A repair is tracked on its own, not
          by a second pass through the stages.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {repairs.total === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No repairs were raised in this period.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {repairs.statuses.map((entry) => (
              <div key={entry.status}>
                <dt className="text-sm text-muted-foreground">{entry.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight">
                  {formatCount(entry.count)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
