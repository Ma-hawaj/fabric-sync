import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberField, TextField } from '@/components/form/fields'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'

interface GiftCardBlockProps {
  form: InvoiceFormApi
  lineIndex: number
  onRemove: () => void
}

export function GiftCardBlock({
  form,
  lineIndex,
  onRemove,
}: GiftCardBlockProps) {
  const base = `giftCards[${lineIndex}]`

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto]">
      <div className="min-w-0">
        <TextField form={form} name={`${base}.code`} label="Code" />
      </div>

      <div className="col-start-1 min-w-0 sm:col-start-auto">
        <NumberField
          form={form}
          name={`${base}.amount`}
          label={`Amount (${CURRENCY})`}
        />
      </div>

      <div className="col-start-1 min-w-0 sm:col-start-auto">
        <TextField
          form={form}
          name={`${base}.expiresOn`}
          label="Expires (optional)"
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onRemove}
        className="col-start-2 row-start-1 mt-6 sm:col-start-4"
        aria-label="Remove gift card"
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
