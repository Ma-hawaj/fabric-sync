import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Order } from '@/features/orders/types/orders'
import { useCancellation, useReturns } from '../hooks/use-returns'
import { CancelOrderDialog } from './cancel-order-dialog'
import { ReturnDialog } from './return-dialog'

export function OrderResolutionActions({
  order,
}: {
  order: Pick<Order, 'id' | 'invoiceId' | 'status' | 'outcome'>
}) {
  const [dialog, setDialog] = useState<'return' | 'cancel' | null>(null)
  const returns = useReturns(dialog === 'return' ? order.invoiceId : null)
  const cancellation = useCancellation(dialog === 'cancel' ? order.id : null)
  if (order.outcome === 'cancelled' || order.outcome === 'returned') return null
  const query = dialog === 'return' ? returns : cancellation
  return (
    <>
      <Button
        variant="outline"
        onClick={() =>
          setDialog(order.status === 'collected' ? 'return' : 'cancel')
        }
      >
        {order.status === 'collected' ? 'Return Order' : 'Cancel Order'}
      </Button>
      {dialog === 'return' && returns.data && (
        <ReturnDialog
          invoiceId={order.invoiceId}
          orderId={order.id}
          context={returns.data}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel' && cancellation.data && (
        <CancelOrderDialog
          context={cancellation.data}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog && !query.data && (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {dialog === 'return'
                  ? 'Return Order & Refund'
                  : 'Cancel Order & Refund'}
              </DialogTitle>
              <DialogDescription>
                {query.isError
                  ? 'Could not load the current invoice balance.'
                  : 'Loading order and refund details...'}
              </DialogDescription>
            </DialogHeader>
            {query.isError && (
              <Button variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
