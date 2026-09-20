import { ShieldAlert } from 'lucide-react'
import { MEASUREMENT_GROUPS, fieldsInGroup } from '../data/measurement-fields'
import type { ThobView } from '../data/thob-sketch'
import type { Measurement } from '../types/customers'
import { ThobDiagram } from './thob-diagram'
import type { MeasurementValues } from './thob-diagram'

const VIEW_TITLES: Record<ThobView, string> = {
  front: 'Front of Thob',
  back: 'Back of Thob',
}

const THOB_VIEWS: ThobView[] = ['front', 'back']

/**
 * A read-only snapshot of a single measurement record, rendered from the same
 * `measurement-fields.ts` catalog the entry form uses — add a measurement
 * there and it shows up here too. Only fields the record actually set are
 * listed, and they're grouped exactly like the form. Above the groups, the
 * garment is drawn from the front and the back with every recorded value
 * called out on the silhouette it belongs to.
 */
export function ReadOnlyMeasurement({
  measurement,
}: {
  measurement: Measurement
}) {
  const groups = MEASUREMENT_GROUPS.map((group) => {
    const recorded = fieldsInGroup(group.id)
      .map((field) => ({ field, value: measurement[field.name] }))
      .filter(
        ({ value }) => value !== undefined && value !== null && value !== '',
      )
    return { group, recorded }
  }).filter(({ recorded }) => recorded.length > 0)

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-card p-4 text-center">
        <ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-1 text-sm text-muted-foreground">
          No measurements on record for this garment.
        </p>
        <p className="text-xs text-muted-foreground/80 mt-0.5">
          Measured {measurement.date.toLocaleDateString()}
        </p>
      </div>
    )
  }

  const values = Object.fromEntries(
    MEASUREMENT_GROUPS.flatMap(({ id }) => fieldsInGroup(id)).map((field) => [
      field.name,
      measurement[field.name],
    ]),
  ) as MeasurementValues

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Measured {measurement.date.toLocaleDateString()} — the cut-to spec for
        this order.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {THOB_VIEWS.map((view) => (
          <div
            key={view}
            className="rounded-xl border border-border/60 bg-card p-3 pb-1 shadow-sm"
          >
            <h5 className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              {VIEW_TITLES[view]}
            </h5>
            <ThobDiagram view={view} showRecorded values={values} />
          </div>
        ))}
      </div>
      {groups.map(({ group, recorded }) => (
        <div
          key={group.id}
          className="rounded-xl border border-border/60 bg-card p-4 shadow-sm"
        >
          <h4 className="mb-3 border-b border-border/30 pb-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            {group.title}
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {recorded.map(({ field, value }) => (
              <div key={field.name} className="flex flex-col">
                <span className="text-xs text-muted-foreground font-medium">
                  {field.label}
                </span>
                <span className="text-sm font-semibold text-foreground mt-0.5">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
