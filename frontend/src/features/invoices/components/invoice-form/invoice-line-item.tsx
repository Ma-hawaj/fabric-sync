import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'
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
          variant="ghost"
          size="icon-lg"
          className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${title.toLowerCase()}`}
          title={`Remove ${title.toLowerCase()}`}
          onClick={onRemove}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      {children}
    </section>
  )
}
