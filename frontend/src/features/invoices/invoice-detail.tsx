import * as React from 'react'
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
import {
  ArrowLeftIcon,
  FileDownIcon,
  MessageCircleIcon,
  ReceiptText,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { ReceiveInvoiceDialog } from './components/receive-invoice-dialog'
import { SendInvoiceWhatsAppDialog } from '@/components/send-invoice-whatsapp-dialog'
import { useInvoice } from './hooks/use-invoice'
import { printInvoiceDocument } from './lib/print-invoice'
import type { Invoice, InvoiceCustomer } from './types/invoices'
import type { InvoiceDetail, InvoiceLine } from './types/invoice-detail'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

const LINE_KIND_LABELS: Record<InvoiceLine['kind'], string> = {
  order: 'Tailoring',
  product: 'Product',
  gift_card: 'Gift Card',
}

export function InvoiceDetailPage({ invoiceId }: { invoiceId: string }) {
  const { data: detail, isLoading, isError } = useInvoice(invoiceId)
  const navigate = useNavigate()

  // The receive dialog was built around the list row's `Invoice`, so the
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
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
            <ReceiptText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Invoice INV-{detail.invoiceNumber}
            </h1>
            <p className="text-muted-foreground">
              {new Date(invoice.date).toLocaleDateString()}
              {detail.branchName ? ` · ${detail.branchName}` : ''}
            </p>
          </div>
        </div>

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

        <div className="flex items-center gap-2">
          <ExportPdfButton invoiceId={invoice.id} />
          <SendWhatsAppButton invoiceId={invoice.id} />
          <ReceiveInvoiceButton
            invoice={invoice}
            disabled={invoice.paymentStatus === 'paid'}
          />
        </div>
      </div>

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
                <div key={customer.mobileNo}>
                  <div className="text-sm font-semibold">{customer.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {customer.mobileNo}
                  </div>
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
                      <div className="font-medium">{line.description}</div>
                      {line.customer && (
                        <div className="text-xs text-muted-foreground">
                          {line.customer.name}
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
          <TotalRow label="Subtotal" value={detail.totals.subtotal} />
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
            label={`VAT (${Math.round(detail.totals.vatRate * 100)}%)`}
            value={detail.totals.vat}
          />
          {detail.totals.giftCardSales > 0 && (
            <TotalRow
              label="Gift cards sold"
              value={detail.totals.giftCardSales}
            />
          )}
          <TotalRow label="Total" value={detail.totals.total} emphasis />
          {detail.totals.giftCardRedeemed > 0 && (
            <TotalRow
              label="Paid by gift card"
              value={-detail.totals.giftCardRedeemed}
            />
          )}
          {detail.totals.amountPaid > 0 && (
            <TotalRow label="Paid" value={-detail.totals.amountPaid} />
          )}
          <TotalRow
            label="Balance due"
            value={detail.totals.balanceDue}
            emphasis
          />
        </dl>
      </div>
    </div>
  )
}

// The receive dialog needs its trigger; keep it self-contained here rather
// than a separate dialog state in this page.
function ReceiveInvoiceButton({
  invoice,
  disabled,
}: {
  invoice: Invoice
  disabled: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button
        variant="outline"
        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {disabled ? 'Received' : 'Mark Received'}
      </Button>
      <ReceiveInvoiceDialog
        invoice={open ? invoice : null}
        onOpenChange={(isOpen) => !isOpen && setOpen(false)}
      />
    </>
  )
}

function SendWhatsAppButton({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageCircleIcon className="h-4 w-4" />
        Send via WhatsApp
      </Button>
      <SendInvoiceWhatsAppDialog
        invoiceId={open ? invoiceId : null}
        kind="resent"
        onOpenChange={(isOpen) => !isOpen && setOpen(false)}
      />
    </>
  )
}

function ExportPdfButton({ invoiceId }: { invoiceId: string }) {
  const [isPrinting, setIsPrinting] = React.useState(false)

  return (
    <Button
      variant="outline"
      disabled={isPrinting}
      onClick={() => {
        setIsPrinting(true)
        const pending = printInvoiceDocument(invoiceId).finally(() =>
          setIsPrinting(false),
        )
        toast.promise(pending, {
          loading: 'Preparing the invoice...',
          success: 'Invoice ready — choose "Save as PDF" to download it.',
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
    date: detail.date,
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
    paymentStatus: detail.paymentStatus,
    amountPaid: detail.totals.amountPaid,
    advanceAmount: detail.advanceAmount,
    advancePaymentType: detail.advancePaymentType,
    finalPaymentType: detail.finalPaymentType,
  }
}

function deduplicate(customers: InvoiceCustomer[]): InvoiceCustomer[] {
  const seen = new Map<string, InvoiceCustomer>()
  for (const customer of customers) {
    seen.set(customer.mobileNo, customer)
  }
  return [...seen.values()]
}

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <h2 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
