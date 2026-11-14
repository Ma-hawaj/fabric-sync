import { useState } from 'react'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useOrder } from '../hooks/use-order'
import { LogRepairDialog } from './log-repair-dialog'
import type { Order } from '../types/orders'

function orderOption(order: Order) {
  const closed = order.outcome !== 'active' ? ` · ${order.outcome}` : ''
  return {
    value: order.id,
    label: `ORD-${order.orderNumber} · INV-${order.invoiceNumber} · ${order.customerName} · ${order.customerMobile} · ${order.material}${closed}`,
  }
}

/** Mounted only while open, so each new repair starts with a fresh selection. */
export function CreateRepairDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
}) {
  const [orderId, setOrderId] = useState<string | null>(null)
  const { data: order, isPending, isError, refetch } = useOrder(orderId)
  const closed = order && order.outcome !== 'active'

  return (
    <LogRepairDialog
      open
      actionLabel="Create Repair"
      order={order && !closed ? order : null}
      onOpenChange={onOpenChange}
      orderPicker={
        <div className="space-y-2">
          <Label htmlFor="repair-order">Order</Label>
          <AsyncCombobox<Order>
            id="repair-order"
            endpoint="/orders"
            queryKey="repair-order-picker"
            searchField={[
              { id: 'orderNumber', type: 'number', prefix: 'ORD-' },
              'customerName',
              'customerMobile',
            ]}
            toOption={orderOption}
            value={orderId}
            onValueChange={setOrderId}
            placeholder="Search by order number, customer name or mobile..."
            emptyMessage="No orders found."
          />
          {orderId && isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading order details...
            </p>
          )}
          {isError && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>Could not load this order. Please try again.</p>
              <Button variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          )}
          {closed && (
            <p role="alert" className="text-sm text-destructive">
              This order is {order.outcome}. Select an active order to create a
              repair.
            </p>
          )}
        </div>
      }
    />
  )
}
