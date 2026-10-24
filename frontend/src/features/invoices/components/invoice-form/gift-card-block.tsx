import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberField, PhoneField, TextField } from '@/components/form/fields'
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
      <div className="grid flex-1 gap-3 sm:grid-cols-2">
        <TextField
          form={form}
          name={`${base}.boughtFor`}
          label="Bought for (optional)"
        />
        <PhoneField
          form={form}
          name={`${base}.recipientPhone`}
          label="Recipient phone"
          defaultCountry="BH"
        />

        <div>
          <NumberField
            form={form}
            name={`${base}.amount`}
            label={`Amount (${CURRENCY})`}
          />
        </div>

        <div>
          <TextField
            form={form}
            name={`${base}.expiresOn`}
            label="Expires (optional)"
          />
        </div>
        <form.Subscribe
          selector={(state) => state.values.giftCards[lineIndex].code}
        >
          {(code) => (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {code
                ? `Code: ${code}`
                : 'A unique code is generated automatically when you save.'}{' '}
              You can also send the card later from Gift Cards.
            </p>
          )}
        </form.Subscribe>
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
