import { ShieldAlert } from 'lucide-react'
import { MEASUREMENT_GROUPS, fieldsInGroup } from '../data/measurement-fields'
import type { Measurement } from '../types/customers'
import { ThobDiagram } from './thob-diagram'
import type { MeasurementValues } from './thob-diagram'

/**
 * A read-only snapshot of a single measurement record, rendered from the same
 * `measurement-fields.ts` catalog the entry form uses — add a measurement
 * there and it shows up here too. Only fields the record actually set are
 * listed, and they're grouped exactly like the form. Above the groups, the
 * thobe sheet draws every recorded value at its slot.
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
          {(measurement.type ?? measurement.fit) && (
            <>
              {' '}
              ({[measurement.type, measurement.fit].filter(Boolean).join(' · ')}
              )
            </>
          )}
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
        {(measurement.type ?? measurement.fit) && (
          <>
            {' '}
            ({[measurement.type, measurement.fit].filter(Boolean).join(' · ')})
          </>
        )}
      </p>
      <div className="rounded-xl border border-border/60 bg-card p-3 pb-1 shadow-sm">
        <h5 className="mb-1 text-xs font-bold uppercase tracking-wider text-info">
          Thobe Sheet
        </h5>
        <ThobDiagram values={values} />
      </div>
      {groups.map(({ group, recorded }) => (
        <div
          key={group.id}
          className="rounded-xl border border-border/60 bg-card p-4 shadow-sm"
        >
          <h4 className="mb-3 border-b border-border/30 pb-2 text-xs font-bold uppercase tracking-wider text-info">
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
