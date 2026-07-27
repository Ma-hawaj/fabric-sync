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
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <TextField form={form} name={`${base}.code`} label="Code" />
      </div>

      <div className="w-36">
        <NumberField
          form={form}
          name={`${base}.amount`}
          label={`Amount (${CURRENCY})`}
        />
      </div>

      <div className="w-40">
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
        className="mt-6"
        aria-label="Remove gift card"
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
