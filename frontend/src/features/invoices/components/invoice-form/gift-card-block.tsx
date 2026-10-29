import {
  DateField,
  NumberField,
  PhoneField,
  TextField,
} from '@/components/form/fields'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'
import { InvoiceLineItem } from './invoice-line-item'

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
    <InvoiceLineItem kind="gift card" lineIndex={lineIndex} onRemove={onRemove}>
      <div className="grid min-w-0 gap-3 @md/invoice-line:grid-cols-2">
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
          <DateField
            form={form}
            name={`${base}.expiresOn`}
            label="Expires (optional)"
          />
        </div>
        <form.Subscribe
          selector={(state) => state.values.giftCards[lineIndex].code}
        >
          {(code) => (
            <p className="text-xs text-muted-foreground @md/invoice-line:col-span-2">
              {code
                ? `Code: ${code}`
                : 'A unique code is generated automatically when you save.'}{' '}
              You can also send the card later from Gift Cards.
            </p>
          )}
        </form.Subscribe>
      </div>
    </InvoiceLineItem>
  )
}
