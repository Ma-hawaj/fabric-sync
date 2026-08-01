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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CURRENCY } from '@/lib/currency'
import { useLocations } from '@/features/locations/hooks/use-locations'
import {
  orderReceivingLocations,
  productionLocations,
} from '@/features/locations/lib/location-filters'
import {
  repairStatusLabel,
  stageBadgeVariant,
  stageStatusLabel,
  stageTimingLabel,
} from '../lib/order-tracking'
import { useSetOrderStage } from '../hooks/use-set-order-stage'
import { useUpdateOrder } from '../hooks/use-update-order'
import { useUpdateRepair } from '../hooks/use-update-repair'
import type { Order, OrderRepair, OrderStageEntry } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

interface OrderTrackingSheetProps {
  order: Order | null
  onOpenChange: (open: boolean) => void
  onLogRepair: (order: Order) => void
}

export function OrderTrackingSheet({
  order,
  onOpenChange,
  onLogRepair,
}: OrderTrackingSheetProps) {
  return (
    <Sheet
      open={order !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle>Track Order</SheetTitle>
              <SheetDescription>
                {order.customerName} — {order.material}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-6">
              <ProductionLocationPicker order={order} />
              <Separator />
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Production</h3>
                <StageChecklist order={order} stages={order.stages} />
              </section>
              <Separator />
              <RepairsSection order={order} onLogRepair={onLogRepair} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ProductionLocationPicker({ order }: { order: Order }) {
  const { data: locations = [] } = useLocations()
  const updateOrder = useUpdateOrder()
  // The rules live in location-filters.ts; never read the flags inline.
  const options = React.useMemo(
    () =>
      productionLocations(locations).map((location) => ({
        value: location.id,
        label: location.name,
      })),
    [locations],
  )

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
      <Select
        items={options}
        value={order.productionLocationId ?? ''}
        onValueChange={(value: string) => void handleChange(value)}
      >
        <SelectTrigger id="production-location" className="w-full">
          <SelectValue placeholder="Not assigned yet..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Collected from {order.receivingLocation ?? 'an unassigned branch'}. A
        delivery stage only applies while these two differ.
      </p>
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
  const { data: locations = [] } = useLocations()
  const [destination, setDestination] = React.useState('')

  // Completing a delivery has to say where the garment went — the backend
  // rejects it otherwise, so the picker appears inline before Done is offered.
  const needsDestination =
    stage.requiresDelivery && stage.applicable && stage.status !== 'done'
  const destinationOptions = React.useMemo(
    () =>
      orderReceivingLocations(locations).map((location) => ({
        value: location.id,
        label: location.name,
      })),
    [locations],
  )

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
    setDestination('')
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
            {stage.status === 'pending' ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-auto px-2"
                  disabled={
                    setStage.isPending || (needsDestination && !destination)
                  }
                  onClick={() => void record('done', destination || undefined)}
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
        <div className="mt-3 space-y-1">
          <Label htmlFor={`destination-${stage.stageId}`}>Deliver To</Label>
          <Select
            items={destinationOptions}
            value={destination}
            onValueChange={(value: string) => setDestination(value)}
          >
            <SelectTrigger
              id={`destination-${stage.stageId}`}
              className="w-full"
            >
              <SelectValue placeholder="Pick a destination..." />
            </SelectTrigger>
            <SelectContent>
              {destinationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </li>
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
