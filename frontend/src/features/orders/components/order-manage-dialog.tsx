import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PermissionGuard } from '@/components/permission-guard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ReadinessControls } from '@/features/notifications/readiness-controls'
import { useOrder } from '../hooks/use-order'
import { CollectOrderDialog } from './collect-order-dialog'
import { LogRepairDialog } from './log-repair-dialog'
import { OrderTrackingPanel } from './order-tracking-panel'

export function OrderManageDialog({
  orderId,
  onOpenChange,
}: {
  orderId: string | null
  onOpenChange: (open: boolean) => void
}) {
  return orderId ? (
    <PermissionGuard method="GET" path="/orders/:id">
      <OrderManageSession
        key={orderId}
        orderId={orderId}
        onOpenChange={onOpenChange}
      />
    </PermissionGuard>
  ) : null
}

function OrderManageSession({
  orderId,
  onOpenChange,
}: {
  orderId: string
  onOpenChange: (open: boolean) => void
}) {
  const { data: order, isPending, isError, refetch } = useOrder(orderId)
  const [collectOpen, setCollectOpen] = useState(false)
  const [repairOpen, setRepairOpen] = useState(false)
  const closed = order?.outcome === 'cancelled' || order?.outcome === 'returned'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Manage Order{order ? ` ORD-${order.orderNumber}` : ''}
          </DialogTitle>
          <DialogDescription>
            {order
              ? `${order.customerName} · ${order.material} · INV-${order.invoiceNumber}`
              : 'Update production and collection without leaving the table.'}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <p role="status">Loading order...</p>
        ) : isError ? (
          <div role="alert" className="space-y-3">
            <p>Could not load this order.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link to="/orders/$orderId" params={{ orderId: order.id }} />
                }
              >
                Full details
              </Button>
              {!closed && (
                <>
                  <ReadinessControls
                    id={order.id}
                    invoiceId={order.invoiceId}
                    scope="orders"
                    collectionMethod={order.collectionMethod}
                    status={order.status}
                    readyAt={order.readyAt}
                    readyBy={order.readyBy}
                  />
                  <PermissionGuard method="POST" path="/orders/:id/collect">
                    <Button
                      variant="outline"
                      disabled={order.status === 'collected'}
                      onClick={() => setCollectOpen(true)}
                    >
                      {order.status === 'collected'
                        ? 'Collected'
                        : 'Mark Collected'}
                    </Button>
                  </PermissionGuard>
                </>
              )}
            </div>
            <OrderTrackingPanel
              order={order}
              onLogRepair={() => setRepairOpen(true)}
            />
            <PermissionGuard method="POST" path="/orders/:id/collect">
              <CollectOrderDialog
                order={collectOpen && !closed ? order : null}
                onOpenChange={setCollectOpen}
              />
            </PermissionGuard>
            <PermissionGuard method="POST" path="/orders/:id/repairs">
              <LogRepairDialog
                order={repairOpen && !closed ? order : null}
                onOpenChange={setRepairOpen}
              />
            </PermissionGuard>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
