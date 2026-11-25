import { useState } from 'react'
import {
  Banknote,
  FilePlus,
  HandCoins,
  History,
  PackageCheck,
  Pencil,
  Undo2,
} from 'lucide-react'
import { CURRENCY } from '@/lib/currency'
import { StaffName } from '@/features/users/components/staff-name'
import { useInvoiceHistory } from '../hooks/use-invoice-history'
import type { FieldChange, InvoiceHistoryEntry } from '../types/invoice-history'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

function formatAmount(value: number) {
  return currencyFormatter.format(value)
}

function entryKey(entry: InvoiceHistoryEntry) {
  switch (entry.kind) {
    case 'created':
      return `created-${entry.at}`
    case 'collection':
      return `collection-${entry.orderId}`
    default:
      return `${entry.kind}-${entry.id}`
  }
}

function EditDetails({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No field changes recorded.
      </p>
    )
  }
  return (
    <ul className="mt-2 space-y-1">
      {changes.map((change) => (
        <li
          key={change.path}
          className="flex flex-wrap items-baseline gap-x-2 text-xs"
        >
          <span className="font-medium">{change.label}</span>
          <span className="text-muted-foreground line-through">
            {change.before ?? '—'}
          </span>
          <span aria-hidden="true">→</span>
          <span>{change.after ?? '—'}</span>
        </li>
      ))}
    </ul>
  )
}

function EditedEntry({
  entry,
}: {
  entry: Extract<InvoiceHistoryEntry, { kind: 'edited' }>
}) {
  const [open, setOpen] = useState(false)
  const totalChanged =
    entry.totalBefore !== null &&
    entry.totalAfter !== null &&
    entry.totalBefore !== entry.totalAfter
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-start text-sm hover:underline"
        aria-expanded={open}
      >
        <span className="font-medium">
          Edited {entry.changes.length}{' '}
          {entry.changes.length === 1 ? 'field' : 'fields'}
        </span>
        {totalChanged && (
          <span className="text-xs text-muted-foreground">
            {formatAmount(entry.totalBefore as number)} →{' '}
            {formatAmount(entry.totalAfter as number)}
          </span>
        )}
      </button>
      {open && <EditDetails changes={entry.changes} />}
    </div>
  )
}

function EntryBody({ entry }: { entry: InvoiceHistoryEntry }) {
  switch (entry.kind) {
    case 'created':
      return <span className="text-sm font-medium">Invoice created</span>
    case 'edited':
      return <EditedEntry entry={entry} />
    case 'payment':
      return (
        <span className="text-sm">
          <span className="font-medium">Payment</span>{' '}
          <span className="tabular-nums">{formatAmount(entry.amount)}</span>
          {entry.paymentType && (
            <span className="text-muted-foreground capitalize">
              {' '}
              · {entry.paymentType}
            </span>
          )}
        </span>
      )
    case 'collection':
      return (
        <span className="text-sm">
          <span className="font-medium">Collected</span>{' '}
          <span className="text-muted-foreground">
            garment #{entry.orderNumber}
          </span>
        </span>
      )
    case 'return':
      return (
        <span className="text-sm">
          <span className="font-medium capitalize">{entry.returnKind}</span>{' '}
          <span className="tabular-nums">{formatAmount(entry.amount)}</span>
          <span className="text-muted-foreground"> · {entry.reason}</span>
        </span>
      )
    case 'refund':
      return (
        <span className="text-sm">
          <span className="font-medium">Refund</span>{' '}
          <span className="tabular-nums">{formatAmount(entry.amount)}</span>
          <span className="text-muted-foreground">
            {' '}
            ·{' '}
            {entry.giftCardCode
              ? `gift card ${entry.giftCardCode}`
              : entry.paymentType}
          </span>
        </span>
      )
  }
}

function entryIcon(entry: InvoiceHistoryEntry) {
  switch (entry.kind) {
    case 'created':
      return <FilePlus className="h-3.5 w-3.5" />
    case 'edited':
      return <Pencil className="h-3.5 w-3.5" />
    case 'payment':
      return <Banknote className="h-3.5 w-3.5" />
    case 'collection':
      return <PackageCheck className="h-3.5 w-3.5" />
    case 'return':
      return <Undo2 className="h-3.5 w-3.5" />
    case 'refund':
      return <HandCoins className="h-3.5 w-3.5" />
  }
}

function entryActor(entry: InvoiceHistoryEntry): string | null {
  switch (entry.kind) {
    case 'created':
    case 'edited':
    case 'payment':
      return entry.actor
    case 'return':
    case 'refund':
      return entry.actor
    case 'collection':
      return null
  }
}

export function InvoiceHistory({ invoiceId }: { invoiceId: string }) {
  const query = useInvoiceHistory(invoiceId)
  const entries = [...(query.data ?? [])].reverse()

  return (
    <section aria-labelledby="invoice-history-heading" className="space-y-2.5">
      <h2
        id="invoice-history-heading"
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <History className="h-3.5 w-3.5" />
        History
      </h2>
      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        )}
        {query.isError && (
          <p className="text-sm text-muted-foreground">
            History could not be loaded.
          </p>
        )}
        {query.data && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No history recorded.</p>
        )}
        {entries.length > 0 && (
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entryKey(entry)}
                className="flex items-start gap-3 border-b border-border/40 pb-3 last:border-b-0 last:pb-0"
              >
                <span className="mt-0.5 text-muted-foreground">
                  {entryIcon(entry)}
                </span>
                <div className="min-w-0 flex-1">
                  <EntryBody entry={entry} />
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <time dateTime={entry.at}>
                      {new Date(entry.at).toLocaleString()}
                    </time>
                    {entryActor(entry) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <StaffName userId={entryActor(entry)} />
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
