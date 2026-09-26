import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CURRENCY } from '@/lib/currency'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { PRODUCTION_FILTERS } from '@/features/locations/lib/location-filters'
import { useApplicableDefaultLocation } from '@/features/locations/hooks/use-default-location'
import { useUsers } from '@/features/users/hooks/use-users'
import type { Location } from '@/features/locations/types/location'
import {
  repairStatusLabel,
  stageBadgeVariant,
  stageStatusLabel,
  stageTimingLabel,
} from '../lib/order-tracking'
import { useSetAssignee } from '../hooks/use-set-assignee'
import { useSetOrderStage } from '../hooks/use-set-order-stage'
import { useUpdateOrder } from '../hooks/use-update-order'
import { useUpdateRepair } from '../hooks/use-update-repair'
import type {
  Order,
  OrderDetail,
  OrderRepair,
  OrderStageEntry,
} from '../types/orders'

// Base UI's Select reserves the empty string, so "nobody assigned" needs a
// real sentinel value rather than ''.
const UNASSIGNED = '__unassigned__'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

interface OrderTrackingPanelProps {
  order: OrderDetail
  onLogRepair: (order: Order) => void
}

/**
 * The working end of the order page — where the production people act on the
 * order. Was once a drawer off the Orders list; on its own page it is plain
 * sections, so the checklist, the assignees, the destination pickers and the
 * repairs live (and refetch) right where the order is being managed.
 */
export function OrderTrackingPanel({
  order,
  onLogRepair,
}: OrderTrackingPanelProps) {
  return (
    <div className="space-y-6">
      <ProductionLocationPicker order={order} />
      <Separator />
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Production</h3>
        <StageChecklist order={order} stages={order.stages} />
      </section>
      <Separator />
      <RepairsSection order={order} onLogRepair={onLogRepair} />
    </div>
  )
}

function ProductionLocationPicker({ order }: { order: Order }) {
  const updateOrder = useUpdateOrder()
  // An existing order is never silently rewritten: the default is offered as
  // a one-tap action while production is still unassigned and uninferred.
  const stockDefault = useApplicableDefaultLocation('stock')
  const showDefaultOffer =
    !order.productionLocationId && !order.productionLocationInferred

  const handleChange = async (productionLocationId: string) => {
    const pending = updateOrder.mutateAsync({
      orderId: order.id,
      productionLocationId,
    })
    toast.promise(pending, {
      loading: 'Assigning production location...',
      success: (updated) =>
        `Production moved to ${updated.productionLocation}.`,
      error: 'Could not assign this location. Please try again.',
    })
    try {
      await pending
    } catch {
      return
    }
  }

  return (
    <section className="space-y-2">
      <Label htmlFor="production-location">Made At</Label>
      <AsyncCombobox<Location>
        id="production-location"
        endpoint="/locations"
        queryKey="production-location-picker"
        searchField="name"
        filters={PRODUCTION_FILTERS}
        placeholder="Not assigned yet..."
        emptyMessage="No locations found."
        toOption={(location) => ({
          value: location.id,
          label: location.name,
        })}
        getValueLabel={(id) =>
          id === order.productionLocationId ? order.productionLocation : null
        }
        value={order.productionLocationId}
        onValueChange={(locationId) => {
          if (locationId !== null) void handleChange(locationId)
        }}
      />
      <p className="text-xs text-muted-foreground">
        Collected from {order.receivingLocation ?? 'an unassigned branch'}. A
        delivery stage only applies while these two differ.
      </p>
      {showDefaultOffer && stockDefault && (
        <Button
          size="sm"
          variant="outline"
          disabled={updateOrder.isPending}
          onClick={() => void handleChange(stockDefault.id)}
        >
          Use {stockDefault.name} (your default)
        </Button>
      )}
      {order.productionLocationInferred && (
        <p className="text-xs text-muted-foreground">
          Inferred from where {order.material} is stocked — pick a location to
          confirm it explicitly.
        </p>
      )}
    </section>
  )
}

function StageChecklist({
  order,
  stages,
}: {
  order: Order
  stages: OrderStageEntry[]
}) {
  if (stages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stages are configured. Add one on the Order Stages page.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {stages.map((stage) => (
        <StageRow key={stage.stageId} order={order} stage={stage} />
      ))}
    </ul>
  )
}

function StageRow({ order, stage }: { order: Order; stage: OrderStageEntry }) {
  const setStage = useSetOrderStage()

  // A delivery goes where the customer collects — the invoice's receiving
  // branch, riding along on the order — so there is no destination picker.
  // The backend still requires a location id, hence the guard on Done below.
  const needsDestination =
    stage.requiresDelivery && stage.applicable && stage.status !== 'done'
  const destinationId = order.receivingLocationId

  const record = async (
    status: OrderStageEntry['status'],
    locationId?: string,
  ) => {
    const pending = setStage.mutateAsync({
      orderId: order.id,
      stageId: stage.stageId,
      status,
      locationId,
    })
    toast.promise(pending, {
      loading: 'Updating stage...',
      success:
        status === 'pending'
          ? `${stage.name} was reopened.`
          : `${stage.name} was marked ${status}.`,
      error: 'Could not update this stage. Please try again.',
    })
    try {
      await pending
    } catch {
      return
    }
  }

  return (
    <li className="rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={
                stage.applicable ? 'font-medium' : 'text-muted-foreground'
              }
            >
              {stage.name}
            </span>
            <Badge variant={stageBadgeVariant(stage.status)}>
              {stageStatusLabel(stage)}
            </Badge>
          </div>
          {!stage.applicable && (
            <p className="mt-1 text-xs text-muted-foreground">
              Not needed — produced at the collection branch.
            </p>
          )}
          {stageTimingLabel(stage) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {stageTimingLabel(stage)}
            </p>
          )}
          {stage.location && (
            <p className="mt-1 text-xs text-muted-foreground">
              Delivered to {stage.location}.
            </p>
          )}
          {stage.notes && (
            <p className="mt-1 text-xs text-muted-foreground">{stage.notes}</p>
          )}
        </div>

        {stage.applicable && (
          <div className="flex shrink-0 items-center gap-1">
            <AssigneePicker order={order} stage={stage} />
            {stage.status === 'pending' ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-auto px-2"
                  disabled={
                    setStage.isPending || (needsDestination && !destinationId)
                  }
                  onClick={() =>
                    void record('done', destinationId ?? undefined)
                  }
                >
                  Done
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-auto px-2"
                  disabled={setStage.isPending}
                  onClick={() => void record('skipped')}
                >
                  Skip
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-auto px-2"
                disabled={setStage.isPending}
                onClick={() => void record('pending')}
              >
                Undo
              </Button>
            )}
          </div>
        )}
      </div>

      {needsDestination && stage.status === 'pending' && (
        <p className="mt-1 text-xs text-muted-foreground">
          {destinationId
            ? `Delivers to ${order.receivingLocation}.`
            : 'Set a receiving branch on the invoice before completing this delivery.'}
        </p>
      )}
    </li>
  )
}

function AssigneePicker({
  order,
  stage,
}: {
  order: Order
  stage: OrderStageEntry
}) {
  const { data: users = [] } = useUsers()
  const setAssignee = useSetAssignee()

  const options = React.useMemo(
    () => users.map((user) => ({ value: user.id, label: user.name })),
    [users],
  )

  const handleChange = async (value: string) => {
    const assigneeId = value === UNASSIGNED ? undefined : value
    const pending = setAssignee.mutateAsync({
      orderId: order.id,
      stageId: stage.stageId,
      assigneeId,
    })
    toast.promise(pending, {
      loading: 'Updating assignee...',
      success: assigneeId
        ? `${stage.name} assigned to ${options.find((option) => option.value === assigneeId)?.label ?? 'someone'}.`
        : `${stage.name} was unassigned.`,
      error: 'Could not update the assignee. Please try again.',
    })
    try {
      await pending
    } catch {
      return
    }
  }

  return (
    <Select
      items={[{ value: UNASSIGNED, label: 'Unassigned' }, ...options]}
      value={stage.assigneeId ?? UNASSIGNED}
      onValueChange={(value) => void handleChange(value ?? UNASSIGNED)}
    >
      <SelectTrigger
        id={`assignee-${stage.stageId}`}
        size="sm"
        className="h-8 w-auto max-w-[9rem]"
      >
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RepairsSection({
  order,
  onLogRepair,
}: {
  order: Order
  onLogRepair: (order: Order) => void
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Repairs</h3>
        <Button size="sm" variant="outline" onClick={() => onLogRepair(order)}>
          Log Repair
        </Button>
      </div>

      {order.repairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This order has not come back for rework.
        </p>
      ) : (
        <div className="space-y-4">
          {order.repairs.map((repair) => (
            <RepairCard key={repair.id} order={order} repair={repair} />
          ))}
        </div>
      )}
    </section>
  )
}

function RepairCard({ order, repair }: { order: Order; repair: OrderRepair }) {
  const updateRepair = useUpdateRepair()
  const isFinished =
    repair.status === 'completed' || repair.status === 'cancelled'

  const setStatus = async (status: OrderRepair['status']) => {
    const pending = updateRepair.mutateAsync({
      orderId: order.id,
      repairId: repair.id,
      status,
    })
    toast.promise(pending, {
      loading: 'Updating repair...',
      success: `Repair marked ${repairStatusLabel(status).toLowerCase()}.`,
      error: 'Could not update this repair. Please try again.',
    })
    try {
      await pending
    } catch {
      return
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{repair.reason}</p>
          <p className="text-xs text-muted-foreground">
            Reported {repair.reportedOn}
            {repair.charge > 0 &&
              ` — ${currencyFormatter.format(repair.charge)}`}
          </p>
          {repair.notes && (
            <p className="mt-1 text-xs text-muted-foreground">{repair.notes}</p>
          )}
        </div>
        <Badge variant={isFinished ? 'outline' : 'secondary'}>
          {repairStatusLabel(repair.status)}
        </Badge>
      </div>

      {!isFinished && (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-auto px-2"
            disabled={updateRepair.isPending}
            onClick={() => void setStatus('cancelled')}
          >
            Cancel Repair
          </Button>
          {repair.status === 'open' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-auto px-2"
              disabled={updateRepair.isPending}
              onClick={() => void setStatus('in_progress')}
            >
              Start
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-auto px-2"
            disabled={updateRepair.isPending}
            onClick={() => void setStatus('completed')}
          >
            Complete
          </Button>
        </div>
      )}
    </div>
  )
}
