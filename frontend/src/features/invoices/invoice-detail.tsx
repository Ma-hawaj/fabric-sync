import { formatVatPercent } from './lib/invoice-pricing'
import { NotificationDialog } from '@/features/notifications/notification-dialog'
import { NotificationHistory } from '@/features/notifications/notification-history'
import {
  ReadinessBadge,
  ReadinessControls,
} from '@/features/notifications/readiness-controls'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
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
import { CURRENCY } from '@/lib/currency'
import { StaffName } from '@/features/users/components/staff-name'
import { OrderPriorityIndicator } from '@/features/orders/components/order-priority-indicator'
import {
  ArrowLeftIcon,
  FileDownIcon,
  PencilIcon,
  ReceiptText,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { CollectInvoiceDialog } from './components/collect-invoice-dialog'
import { RecordPaymentDialog } from './components/record-payment-dialog'
import { InvoicePaymentHistory } from './components/invoice-payment-history'
import {
  ReturnsPanel,
  RefundPendingCreditAction,
} from '@/features/returns/components/returns-panel'
import { useReturns } from '@/features/returns/hooks/use-returns'
import { useInvoice } from './hooks/use-invoice'
import { downloadInvoicePdf } from './lib/print-invoice'
import type { Invoice, InvoiceCustomer } from './types/invoices'
import type { InvoiceDetail, InvoiceLine } from './types/invoice-detail'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

const LINE_KIND_LABELS: Record<InvoiceLine['kind'], string> = {
  order: 'Tailoring',
  product: 'Product',
  material: 'Material',
  gift_card: 'Gift Card',
}

export function InvoiceDetailPage({ invoiceId }: { invoiceId: string }) {
  const { data: detail, isLoading, isError } = useInvoice(invoiceId)
  const { data: adjustments } = useReturns(invoiceId)
  const navigate = useNavigate()
  const [resendOpen, setResendOpen] = useState(false)

  // The collect dialog was built around the list row's `Invoice`, so the
  // detail is narrowed into that shape for it — the arithmetic it shows comes
  // from `totals` here, never re-derived.
  const invoice: Invoice | null = detail ? toInvoice(detail) : null

  if (isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground">
        Loading invoice details...
      </div>
    )
  }

  if (isError || !detail || !invoice) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
        Could not load this invoice.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <NotificationDialog
        invoiceId={resendOpen ? invoiceId : null}
        kind="manual_resend"
        onClose={() => setResendOpen(false)}
      />
      <div>
        <Link
          to="/invoices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Invoices
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-info/10 text-info">
            <ReceiptText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              Invoice INV-{detail.invoiceNumber}
            </h1>
            <p className="text-muted-foreground">
              {new Date(invoice.date).toLocaleString()}
              {invoice.targetDate
                ? ` · Target ${new Date(invoice.targetDate).toLocaleDateString()}`
                : ''}
              {detail.branchName ? ` · ${detail.branchName}` : ''}
            </p>
            <p className="text-sm text-muted-foreground">
              Created by: <StaffName userId={detail.createdBy} />
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ReadinessBadge {...detail} />
          <Badge variant="outline">
            {detail.collectionMethod === 'delivery' ? 'Delivery' : 'Pickup'}
          </Badge>
          <Badge
            variant={invoice.paymentStatus === 'paid' ? 'default' : 'outline'}
            className="capitalize"
          >
            {invoice.paymentStatus === 'partial'
              ? 'Partially paid'
              : invoice.paymentStatus === 'paid'
                ? 'Paid'
                : 'Unpaid'}
          </Badge>
          <Badge variant={invoice.collected ? 'default' : 'secondary'}>
            {invoice.collected ? 'Collection complete' : 'Pending collection'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportPdfButton invoiceId={invoice.id} />
          <Button variant="outline" onClick={() => setResendOpen(true)}>
            Resend invoice via WhatsApp
          </Button>
          {detail.orderCount > 0 && (
            <ReadinessControls
              id={invoiceId}
              invoiceId={invoiceId}
              scope="invoices"
              status={
                detail.readinessStatus ??
                (detail.collected ? 'collected' : 'in_progress')
              }
            />
          )}

          <Button
            variant="outline"
            disabled={detail.hasAdjustments}
            onClick={() =>
              void navigate({
                to: '/invoices/$invoiceId/edit',
                params: { invoiceId: invoice.id },
              })
            }
          >
            <PencilIcon className="h-4 w-4" />
            Edit
          </Button>
          <CollectInvoiceButton invoice={invoice} />
          <RecordPaymentButton invoice={invoice} />
        </div>
      </div>

      <NotificationHistory invoiceId={invoiceId} />
      <div>
        <SectionHeading icon={<Users className="h-3.5 w-3.5" />}>
          Customers
        </SectionHeading>
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          {invoice.customers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Walk-in customer.</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {invoice.customers.map((customer) => (
                <div key={JSON.stringify([customer.name, customer.mobileNo])}>
                  <div className="text-sm font-semibold">{customer.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {customer.mobileNo}
                  </div>
                  {customer.address && (
                    <div className="text-xs whitespace-pre-line text-muted-foreground">
                      {customer.address}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <SectionHeading icon={<ReceiptText className="h-3.5 w-3.5" />}>
          Line Items
        </SectionHeading>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-end">Qty</TableHead>
                <TableHead className="text-end">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((line, index) => {
                const orderId = line.kind === 'order' ? line.orderId : null
                return (
                  <TableRow
                    key={`${line.description}-${index}`}
                    className={orderId ? 'cursor-pointer' : undefined}
                    onClick={
                      orderId
                        ? () =>
                            void navigate({
                              to: '/orders/$orderId',
                              params: { orderId },
                            })
                        : undefined
                    }
                  >
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">
                        <span>{line.description}</span>
                        <OrderPriorityIndicator isUrgent={line.isUrgent} />
                      </div>
                      {line.orderId &&
                        adjustments?.returns.some((entry) =>
                          entry.lines.some(
                            (item) => item.lineId === line.orderId,
                          ),
                        ) && (
                          <Badge variant="secondary">
                            {adjustments.returns.find((entry) =>
                              entry.lines.some(
                                (item) => item.lineId === line.orderId,
                              ),
                            )?.kind === 'cancellation'
                              ? 'Cancelled'
                              : 'Returned'}
                          </Badge>
                        )}
                      {line.customer && (
                        <div className="text-xs text-muted-foreground">
                          {line.customer.name}
                        </div>
                      )}
                      {line.urgentCharge > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Urgent charge for this order (incl. VAT):{' '}
                          {currencyFormatter.format(line.urgentCharge)}
                        </div>
                      )}
                      {line.detail && (
                        <div className="text-xs text-muted-foreground">
                          {line.detail}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {LINE_KIND_LABELS[line.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {line.quantity}
                      {line.unit ? ` ${line.unit}` : ''}
                    </TableCell>
                    <TableCell className="text-end font-medium tabular-nums">
                      {currencyFormatter.format(line.lineTotal)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <dl className="ms-auto max-w-sm space-y-1.5 text-sm">
          <TotalRow
            label="Subtotal (incl. VAT)"
            value={detail.totals.subtotal}
          />
          {detail.totals.discountAmount > 0 && (
            <TotalRow
              label={
                detail.totals.discountUnit === 'percent'
                  ? `Discount (${detail.totals.discount}%)`
                  : 'Discount'
              }
              value={-detail.totals.discountAmount}
            />
          )}
          <TotalRow
            label={`VAT (${formatVatPercent(detail.totals.vatRate)}%)`}
            value={detail.totals.vat}
          />
          {detail.totals.giftCardSales > 0 && (
            <TotalRow
              label="Gift cards sold"
              value={detail.totals.giftCardSales}
            />
          )}
          {detail.totals.urgentCharge > 0 && (
            <TotalRow
              label="Urgent charges (incl. VAT)"
              value={detail.totals.urgentCharge}
            />
          )}
          <TotalRow
            label="Invoice total"
            value={detail.totals.total}
            emphasis
          />
          {detail.hasAdjustments && (
            <>
              <TotalRow
                label="Return / cancellation credits"
                value={-detail.totals.amountCredited}
              />
              <TotalRow label="After credits" value={detail.totals.netTotal} />
            </>
          )}
          {detail.totals.giftCardRedeemed > 0 && (
            <TotalRow
              label="Paid by gift card"
              value={-detail.totals.giftCardRedeemed}
            />
          )}
          {detail.totals.amountPaid > 0 && (
            <TotalRow label="Paid" value={-detail.totals.amountPaid} />
          )}
          {detail.totals.cashRefunded > 0 && (
            <TotalRow
              label="Refunds paid back"
              value={detail.totals.cashRefunded}
            />
          )}
          {detail.totals.giftCardRefunded > 0 && (
            <TotalRow
              label="Restored to gift cards"
              value={detail.totals.giftCardRefunded}
            />
          )}
          {(detail.totals.cashRefunded > 0 ||
            detail.totals.giftCardRefunded > 0) && (
            <TotalRow
              label="Net paid (all methods)"
              value={
                detail.totals.netAmountPaid + detail.totals.netGiftCardRedeemed
              }
            />
          )}
          {detail.totals.refundDue > 0 && (
            <TotalRow
              label="Refund due"
              value={detail.totals.refundDue}
              emphasis
            />
          )}
          <TotalRow
            label="Balance due"
            value={detail.totals.balanceDue}
            emphasis
          />
        </dl>
      </div>

      <ReturnsPanel invoiceId={detail.id} />

      {(detail.payments.length > 0 ||
        (adjustments?.refunds.length ?? 0) > 0 ||
        detail.totals.refundDue > 0) && (
        <section aria-labelledby="payments-heading">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
            <SectionHeading
              id="payments-heading"
              icon={<ReceiptText className="h-3.5 w-3.5" />}
            >
              Payments & Refunds
            </SectionHeading>
            <RefundPendingCreditAction
              invoiceId={detail.id}
              context={adjustments}
            />
          </div>
          <div className="rounded-xl border border-border/60 bg-card shadow-sm">
            <InvoicePaymentHistory
              payments={detail.payments}
              refunds={adjustments?.refunds ?? []}
            />
          </div>
        </section>
      )}
    </div>
  )
}

// The collect dialog needs its trigger; keep it self-contained here rather
// than a separate dialog state in this page.
function CollectInvoiceButton({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        className="text-info hover:text-info/80 hover:bg-info/5 dark:hover:bg-info/10"
        onClick={() => setOpen(true)}
      >
        Mark Collected
      </Button>
      <CollectInvoiceDialog
        invoice={open ? invoice : null}
        onOpenChange={(isOpen) => !isOpen && setOpen(false)}
      />
    </>
  )
}

// Money without collecting anything — an advance now, or the remainder after
// everything was already collected. Disabled once nothing is left to pay.
function RecordPaymentButton({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        disabled={invoice.balanceDue <= 0}
        onClick={() => setOpen(true)}
      >
        Record Payment
      </Button>
      <RecordPaymentDialog
        invoice={open ? invoice : null}
        onOpenChange={(isOpen) => !isOpen && setOpen(false)}
      />
    </>
  )
}

function ExportPdfButton({ invoiceId }: { invoiceId: string }) {
  const [isPrinting, setIsPrinting] = useState(false)

  return (
    <Button
      variant="outline"
      disabled={isPrinting}
      onClick={() => {
        setIsPrinting(true)
        const pending = downloadInvoicePdf(invoiceId).finally(() =>
          setIsPrinting(false),
        )
        toast.promise(pending, {
          loading: 'Preparing the invoice...',
          success: 'Invoice PDF downloaded.',
          error: 'Could not prepare this invoice. Please try again.',
        })
      }}
    >
      <FileDownIcon className="h-4 w-4" />
      Export PDF
    </Button>
  )
}

function toInvoice(detail: InvoiceDetail): Invoice {
  const customers = detail.buyer
    ? [detail.buyer]
    : deduplicate(
        detail.lines
          .map((line) => line.customer)
          .filter((customer): customer is InvoiceCustomer => customer !== null),
      )

  return {
    id: detail.id,
    createdBy: detail.createdBy,
    invoiceNumber: detail.invoiceNumber,
    date: detail.date,
    targetDate: detail.targetDate,
    customers,
    itemCount: detail.lines.length,
    materials: [
      ...new Set(
        detail.lines
          .filter((line) => line.kind !== 'gift_card')
          .map((line) => line.description),
      ),
    ],
    totalPrice: detail.totals.total,
    netTotal: detail.totals.netTotal,
    amountCredited: detail.totals.amountCredited,
    amountRefunded: detail.totals.cashRefunded + detail.totals.giftCardRefunded,
    refundDue: detail.totals.refundDue,
    urgentCharge: detail.totals.urgentCharge,
    collectionMethod: detail.collectionMethod,
    paymentStatus: detail.paymentStatus,
    amountPaid: detail.totals.netAmountPaid,
    balanceDue: detail.totals.balanceDue,
    paymentMethod: detail.paymentMethod,
    giftCardRedeemed: detail.totals.netGiftCardRedeemed,
    collected: detail.collected,
    orderCount: detail.orderCount,
    collectedOrderCount: detail.collectedOrderCount,
    lastCollectedAt: detail.lastCollectedAt,
    receivingLocation: detail.branchName,
    // The detail endpoint carries no production locations (lines carry no
    // location), so the list's production filter has nothing to reuse here —
    // the dialog only needs the money and collection state.
    productionLocations: [],
  }
}

function deduplicate(customers: InvoiceCustomer[]): InvoiceCustomer[] {
  const seen = new Map<string, InvoiceCustomer>()
  for (const customer of customers) {
    seen.set(JSON.stringify([customer.name, customer.mobileNo]), customer)
  }
  return [...seen.values()]
}

function SectionHeading({
  id,
  icon,
  children,
}: {
  id?: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <h2
      id={id}
      className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
    >
      {icon}
      {children}
    </h2>
  )
}

function TotalRow({
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
