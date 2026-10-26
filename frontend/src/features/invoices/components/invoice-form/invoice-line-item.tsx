import type { ReactNode } from 'react'
import { Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface InvoiceLineItemProps {
  kind: 'material' | 'product' | 'gift card'
  lineIndex: number
  onRemove: () => void
  children: ReactNode
}

export function InvoiceLineItem({
  kind,
  lineIndex,
  onRemove,
  children,
}: InvoiceLineItemProps) {
  const title = `${kind[0].toUpperCase()}${kind.slice(1)} ${lineIndex + 1}`

  return (
    <section
      aria-label={title}
      className="@container/invoice-line min-w-0 space-y-3 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-8 shrink-0 px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${kind}`}
          onClick={onRemove}
        >
          <Trash2Icon className="size-3.5" />
          Remove
        </Button>
      </div>
      {children}
    </section>
  )
}
