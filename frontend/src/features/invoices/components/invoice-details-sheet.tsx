import * as React from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { FileDownIcon, ReceiptText, Users } from 'lucide-react'
import { toast } from 'sonner'
import { CURRENCY } from '@/lib/currency'
import { useInvoice } from '../hooks/use-invoice'
import { printInvoiceDocument } from '../lib/print-invoice'
import type { Invoice } from '../types/invoices'
import type { InvoiceLine } from '../types/invoice-detail'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

const LINE_KIND_LABELS: Record<InvoiceLine['kind'], string> = {
  order: 'Tailoring',
  product: 'Product',
  gift_card: 'Gift Card',
}

interface InvoiceDetailsSheetProps {
  invoice: Invoice | null
  onOpenChange: (open: boolean) => void
}

export function InvoiceDetailsSheet({
  invoice,
  onOpenChange,
}: InvoiceDetailsSheetProps) {
  const { data: detail, isLoading, isError } = useInvoice(invoice?.id ?? null)

  return (
    <Sheet
      open={invoice !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-[62vw] overflow-y-auto bg-background/95 backdrop-blur-md border-s shadow-2xl">
        {invoice && (
          <div className="space-y-6 pb-8">
            <SheetHeader className="border-b pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
                    <ReceiptText className="h-5 w-5" />
                  </div>
                  <div>
                    <SheetTitle className="text-xl font-bold tracking-tight">
                      {detail
                        ? `Invoice INV-${detail.invoiceNumber}`
                        : 'Invoice'}
                    </SheetTitle>
                    <SheetDescription className="text-muted-foreground mt-0.5">
                      {new Date(invoice.date).toLocaleDateString()}
                      {detail?.branchName ? ` · ${detail.branchName}` : ''}
                    </SheetDescription>
                  </div>
                </div>

                {/* Clear of the sheet's own close control, which sits in the
                    top corner. */}
                <div className="me-8">
                  <ExportPdfButton invoiceId={invoice.id} disabled={!detail} />
                </div>
              </div>
            </SheetHeader>

            {isLoading && (
              <LoadingIndicator
                label="Loading invoice details..."
                className="py-6"
              />
            )}

            {isError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
                Could not load this invoice's line items.
              </div>
            )}

            {detail && (
              <>
                <div>
                  <SectionHeading icon={<Users className="h-3.5 w-3.5" />}>
                    Customers
                  </SectionHeading>
                  <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                    {invoice.customers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Walk-in customer.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {invoice.customers.map((customer) => (
                          <div key={customer.mobileNo}>
                            <div className="text-sm font-semibold">
                              {customer.name}
                            </div>
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
                  <SectionHeading
                    icon={<ReceiptText className="h-3.5 w-3.5" />}
                  >
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
                        {detail.lines.map((line, index) => (
                          <TableRow key={`${line.description}-${index}`}>
                            <TableCell>
                              <div className="font-medium">
                                {line.description}
                              </div>
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
                        ))}
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
                    <TotalRow
                      label="Total"
                      value={detail.totals.total}
                      emphasis
                    />
                    {detail.totals.giftCardRedeemed > 0 && (
                      <TotalRow
                        label="Paid by gift card"
                        value={-detail.totals.giftCardRedeemed}
                      />
                    )}
                    {detail.totals.amountPaid > 0 && (
                      <TotalRow
                        label="Paid"
                        value={-detail.totals.amountPaid}
                      />
                    )}
                    <TotalRow
                      label="Balance due"
                      value={detail.totals.balanceDue}
                      emphasis
                    />
                  </dl>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ExportPdfButton({
  invoiceId,
  disabled,
}: {
  invoiceId: string
  disabled: boolean
}) {
  const [isPrinting, setIsPrinting] = React.useState(false)

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || isPrinting}
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

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
      {icon}
      {children}
    </h3>
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
