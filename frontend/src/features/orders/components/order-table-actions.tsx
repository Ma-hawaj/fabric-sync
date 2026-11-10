import { Link } from '@tanstack/react-router'
import { CheckIcon, EyeIcon, FileDownIcon, ListChecksIcon } from 'lucide-react'
import { toast } from 'sonner'
import { RowActions } from '@/components/data-table/row-actions'
import { printOrderDocument } from '../lib/print-order'
import type { Order } from '../types/orders'

export function OrderTableActions({
  order,
  onManage,
  onCollect,
}: {
  order: Order
  onManage: (order: Order) => void
  onCollect: (order: Order) => void
}) {
  return (
    <RowActions
      items={[
        {
          permission: { method: 'GET', path: '/orders/:id' },
          label: 'Manage Order',
          icon: ListChecksIcon,
          onClick: () => onManage(order),
        },
        {
          permission: { method: 'GET', path: '/orders/:id' },
          label: 'View Details',
          icon: EyeIcon,
          render: <Link to="/orders/$orderId" params={{ orderId: order.id }} />,
        },
        {
          permission: { method: 'GET', path: '/orders/:id/document' },
          label: 'Export PDF',
          icon: FileDownIcon,
          onClick: () => {
            toast.promise(printOrderDocument(order.id), {
              loading: 'Preparing the order...',
              success: 'Order ready to print.',
              error: 'Could not prepare this order. Please try again.',
            })
          },
        },
        {
          permission: { method: 'POST', path: '/orders/:id/collect' },
          label: order.status === 'collected' ? 'Collected' : 'Mark Collected',
          icon: CheckIcon,
          disabled:
            order.status === 'collected' ||
            order.outcome === 'cancelled' ||
            order.outcome === 'returned',
          onClick: () => onCollect(order),
          separatorBefore: true,
        },
      ]}
    />
  )
}
