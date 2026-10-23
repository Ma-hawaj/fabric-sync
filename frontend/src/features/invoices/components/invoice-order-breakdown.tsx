import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useOrders } from '@/features/orders/hooks/use-orders'
import type { Order } from '@/features/orders/types/orders'
import { CURRENCY } from '@/lib/currency'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

export function InvoiceOrderBreakdown({ invoiceId }: { invoiceId: string }) {
  const params = new URLSearchParams({
    filters: JSON.stringify([
      { id: 'invoiceId', value: invoiceId, variant: 'text', operator: 'eq' },
    ]),
  })
  const { data: orders, isPending, isError, refetch } = useOrders(params)
  const groups = new Map<
    string,
    { name: string; mobile: string; orders: Order[] }
  >()
  for (const order of orders) {
    const key = JSON.stringify([order.customerName, order.customerMobile])
    const group = groups.get(key) ?? {
      name: order.customerName,
      mobile: order.customerMobile,
      orders: [],
    }
    group.orders.push(order)
    groups.set(key, group)
  }

  return (
    <div
      id={`invoice-orders-${invoiceId}`}
      role="region"
      aria-label="Invoice order breakdown"
      className="space-y-4"
    >
      {isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading orders...
        </p>
      ) : isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <span>Could not load this invoice’s orders.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            Retry
          </Button>
        </div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tailoring orders on this invoice.
        </p>
      ) : (
        Array.from(groups, ([key, group]) => (
          <section key={key} className="rounded-lg border bg-background p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{group.name}</h3>
                <p dir="ltr" className="text-xs text-muted-foreground">
                  {group.mobile}
                </p>
              </div>
              <div className="text-end text-sm">
                <p className="font-medium">
                  {currencyFormatter.format(
                    group.orders.reduce(
                      (sum, order) => sum + order.price + order.urgentCharge,
                      0,
                    ),
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Order subtotal before invoice discounts
                </p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Made At</TableHead>
                  <TableHead>Collection</TableHead>
                  <TableHead className="text-end">Price incl. VAT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        to="/orders/$orderId"
                        params={{ orderId: order.id }}
                        className="font-mono text-info hover:underline"
                      >
                        ORD-{order.orderNumber}
                      </Link>
                      {order.isUrgent && (
                        <Badge variant="destructive">Urgent</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>{order.material}</div>
                    </TableCell>
                    <TableCell>{order.materialAmount} m</TableCell>
                    <TableCell>{order.productionLocation ?? '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          order.status === 'collected' ? 'default' : 'secondary'
                        }
                      >
                        {order.status === 'collected'
                          ? 'Collected'
                          : order.status === 'ready'
                            ? 'Ready for pickup'
                            : 'In progress'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {currencyFormatter.format(
                        order.price + order.urgentCharge,
                      )}
                      {order.urgentCharge > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Includes{' '}
                          {currencyFormatter.format(order.urgentCharge)} urgent
                          charge
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))
      )}
    </div>
  )
}
