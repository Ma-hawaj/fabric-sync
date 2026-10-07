import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CURRENCY } from '@/lib/currency'
import { ReadOnlyMeasurement } from '@/features/customers/components/read-only-measurement'
import {
  ArrowLeftIcon,
  FileDownIcon,
  PackageCheckIcon,
  Ruler,
  Shirt,
  Truck,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  FRONT_POCKET,
  NECK,
  PATTI,
  SLEEVE,
  THOB_TYPE,
} from '@/features/invoices/data/design-catalog'
import type { ThobDesignOption } from '@/features/invoices/data/design-catalog'
import { OrderTrackingPanel } from './components/order-tracking-panel'
import { LogRepairDialog } from './components/log-repair-dialog'
import { ReceiveOrderDialog } from './components/receive-order-dialog'
import { useOrder } from './hooks/use-order'
import { printOrderDocument } from './lib/print-order'
import type { OrderDetail } from './types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

export function OrderDetailPage({ orderId }: { orderId: string }) {
  const { data: order, isLoading, isError } = useOrder(orderId)
  const [repairOrderId, setRepairOrderId] = React.useState<string | null>(null)
  const [receiveOpen, setReceiveOpen] = React.useState(false)

  if (isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground">
        Loading order...
      </div>
    )
  }

  if (isError || !order) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
        Could not load this order.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Orders
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-info/10 text-info">
              <PackageCheckIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Order ORD-{order.orderNumber}
              </h1>
              <p className="text-muted-foreground">
                {order.customerName}
                {' · '}
                {new Date(order.invoiceDate).toLocaleDateString()}
                {' · '}
                <span className="font-mono">INV-{order.invoiceNumber}</span>
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Badge
              variant={order.status === 'received' ? 'default' : 'secondary'}
            >
              {order.status === 'received' ? 'Received' : 'Pending'}
            </Badge>
            <Badge
              variant={
                order.invoicePaymentStatus === 'paid' ? 'default' : 'outline'
              }
              className="capitalize"
            >
              {order.invoicePaymentStatus === 'partial'
                ? 'Partially paid'
                : order.invoicePaymentStatus === 'paid'
                  ? 'Paid'
                  : 'Unpaid'}
            </Badge>
          </div>
        </div>

        {!order.productionLocationInferred && (
          <p className="text-xs text-muted-foreground">
            Made at {order.productionLocation ?? 'no location assigned yet'}
          </p>
        )}

        <div className="flex items-center gap-2">
          <ExportPdfButton order={order} />
          <Button
            variant="outline"
            className="text-info hover:text-info/80 hover:bg-info/5 dark:hover:bg-info/10"
            disabled={order.status === 'received'}
            onClick={() => setReceiveOpen(true)}
          >
            {order.status === 'received' ? 'Received' : 'Mark Received'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailCard icon={<Users className="h-3.5 w-3.5" />} title="Customer">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{order.customerName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Mobile</dt>
              <dd className="font-medium" dir="ltr">
                {order.customerMobile}
              </dd>
            </div>
          </dl>
        </DetailCard>

        <DetailCard icon={<Truck className="h-3.5 w-3.5" />} title="Order">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Material</dt>
              <dd className="font-medium">{order.material}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Quantity</dt>
              <dd className="font-medium">{order.materialAmount} m</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Price</dt>
              <dd className="font-medium">
                {currencyFormatter.format(order.price)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Made at</dt>
              <dd className="font-medium">
                {order.productionLocation ?? 'Not assigned'}
                {order.productionLocationInferred && ' (inferred)'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Collected from</dt>
              <dd className="font-medium">
                {order.receivingLocation ?? 'Not assigned'}
              </dd>
            </div>
            {order.currentStage && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Current stage</dt>
                <dd className="font-medium">{order.currentStage}</dd>
              </div>
            )}
          </dl>
        </DetailCard>
      </div>

      <section className="space-y-3">
        <SectionHeading icon={<Shirt className="h-3.5 w-3.5" />}>
          Design
        </SectionHeading>
        <DesignDetails order={order} />
      </section>

      <section className="space-y-3">
        <SectionHeading icon={<Ruler className="h-3.5 w-3.5" />}>
          Measurements
        </SectionHeading>
        <ReadOnlyMeasurement measurement={order.measurement} />
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
        <OrderTrackingPanel
          order={order}
          onLogRepair={(o) => setRepairOrderId(o.id)}
        />
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <dl className="ms-auto max-w-sm space-y-1.5 text-sm">
          <PaymentRow label="Invoice Total" value={order.invoiceTotalPrice} />
          {order.invoiceGiftCardRedeemed > 0 && (
            <PaymentRow
              label="Paid by gift card"
              value={-order.invoiceGiftCardRedeemed}
            />
          )}
          <PaymentRow label="Paid" value={-order.invoiceAmountPaid} />
          <PaymentRow
            label="Balance due"
            value={order.invoiceBalanceDue}
            emphasis
          />
        </dl>
      </section>

      <ReceiveOrderDialog
        order={receiveOpen ? order : null}
        onOpenChange={(open) => !open && setReceiveOpen(false)}
      />

      <LogRepairDialog
        order={repairOrderId === order.id ? order : null}
        onOpenChange={(open) => !open && setRepairOrderId(null)}
      />
    </div>
  )
}

// The made-to-measure choices, in the same fixed slot order the invoice
// document prints them in. A stored value that matches a catalog id shows its
// illustration; a legacy free-text value (e.g. "Saudi") shows as text only.
const DESIGN_SLOTS: {
  label: string
  value: (order: OrderDetail) => string | null
  options: ThobDesignOption[]
}[] = [
  {
    label: 'Thobe Type',
    value: (order) => order.thobeType,
    options: THOB_TYPE,
  },
  { label: 'Collar', value: (order) => order.collar, options: NECK },
  { label: 'Sleeve', value: (order) => order.sleeve, options: SLEEVE },
  {
    label: 'Front Pocket',
    value: (order) => order.fPocket,
    options: FRONT_POCKET,
  },
  { label: 'Patti', value: (order) => order.patti, options: PATTI },
  // EMD has no illustrated catalog — its options carry no images, so any
  // stored value renders as text.
  { label: 'EMD', value: (order) => order.emd, options: [] },
]

function DesignDetails({ order }: { order: OrderDetail }) {
  const slots = DESIGN_SLOTS.map((slot) => {
    const raw = slot.value(order)?.trim() ?? ''
    if (!raw) return null
    const match = slot.options.find((option) => option.id === raw)
    return { label: slot.label, raw, match: match ?? null }
  }).filter((slot): slot is NonNullable<typeof slot> => slot !== null)
  const note = order.moreDetails?.trim() || null

  if (slots.length === 0 && !note) {
    return (
      <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground shadow-sm">
        No design choices recorded.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      {slots.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {slots.map((slot) => (
            <div
              key={slot.label}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-background p-2 text-center"
            >
              {slot.match ? (
                <img
                  src={slot.match.image}
                  alt={slot.match.label}
                  draggable={false}
                  className="h-20 w-full object-contain"
                />
              ) : null}
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {slot.label}
              </div>
              <div className="text-sm font-semibold leading-tight">
                {slot.match ? slot.match.label : slot.raw}
              </div>
            </div>
          ))}
        </div>
      )}
      {note && (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Note: </span>
          {note}
        </p>
      )}
    </div>
  )
}

function ExportPdfButton({ order }: { order: OrderDetail }) {
  const [isPrinting, setIsPrinting] = React.useState(false)

  return (
    <Button
      variant="outline"
      disabled={isPrinting}
      onClick={() => {
        setIsPrinting(true)
        const pending = printOrderDocument(order.id).finally(() =>
          setIsPrinting(false),
        )
        toast.promise(pending, {
          loading: 'Preparing the order...',
          success: 'Order ready — choose "Save as PDF" to download it.',
          error: 'Could not prepare this order document. Please try again.',
        })
      }}
    >
      <FileDownIcon className="h-4 w-4" />
      Export PDF
    </Button>
  )
}

function DetailCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {children}
    </h2>
  )
}

function PaymentRow({
  label,
  value,
  emphasis,
}: {
  label: string
  value: number
  emphasis?: boolean
}) {
  return (
    <div className="flex justify-between gap-6">
      <dt className={emphasis ? 'font-semibold' : 'text-muted-foreground'}>
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? 'font-bold tabular-nums'
            : 'font-medium tabular-nums text-foreground'
        }
      >
        {currencyFormatter.format(value)}
      </dd>
    </div>
  )
}
