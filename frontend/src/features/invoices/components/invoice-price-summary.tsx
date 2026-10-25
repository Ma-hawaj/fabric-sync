import type { ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { CURRENCY } from '@/lib/currency'

const formatCurrency = (amount: number) => `${CURRENCY} ${amount.toFixed(2)}`

/** The same price hierarchy for the live form and a saved invoice. */
export function InvoicePriceSummary({
  total,
  vat,
  vatRate,
  formatAmount = formatCurrency,
  children,
}: {
  total: number
  vat: number
  vatRate: number
  formatAmount?: (amount: number) => string
  children: ReactNode
}) {
  // Gift card sales remain part of the invoice, but carry no VAT. Subtract
  // only the actual VAT so this also works for mixed and gift-card-only sales.
  const withoutVat = Math.round((total - vat) * 100) / 100

  return (
    <div className="space-y-3">
      <dl className="space-y-2 text-sm tabular-nums">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Total without VAT</dt>
          <dd className="shrink-0 font-medium">{formatAmount(withoutVat)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            VAT ({Math.round(vatRate * 100)}%)
          </dt>
          <dd className="shrink-0">{formatAmount(vat)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t pt-3 font-semibold">
          <dt>Total incl. VAT</dt>
          <dd className="shrink-0 text-lg">{formatAmount(total)}</dd>
        </div>
      </dl>
      <details className="group rounded-lg border border-border/60 text-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          Price breakdown
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-2 border-t px-3 py-3 tabular-nums">
          {children}
        </div>
      </details>
    </div>
  )
}
