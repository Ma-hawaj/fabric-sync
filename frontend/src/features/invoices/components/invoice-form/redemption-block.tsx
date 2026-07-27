import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NumberField } from '@/components/form/fields'
import type { GiftCard } from '@/features/gift-cards/types/gift-card'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'

function cardLabel(card: GiftCard) {
  return `${card.code} — ${CURRENCY} ${card.balance.toFixed(2)} left`
}

interface RedemptionBlockProps {
  form: InvoiceFormApi
  lineIndex: number
  /** Cards that can still be spent on this invoice's date. */
  giftCards: GiftCard[]
  onRemove: () => void
}

export function RedemptionBlock({
  form,
  lineIndex,
  giftCards,
  onRemove,
}: RedemptionBlockProps) {
  const base = `redemptions[${lineIndex}]`

  return (
    <div className="flex items-start gap-3">
      <form.Field name={`${base}.code` as never}>
        {(field: any) => {
          const selected =
            giftCards.find((card) => card.code === field.state.value) ?? null

          return (
            <Field
              data-invalid={field.state.meta.errors.length > 0}
              className="flex-1"
            >
              <FieldLabel htmlFor={field.name}>Gift Card</FieldLabel>
              <Combobox
                items={giftCards}
                itemToStringLabel={cardLabel}
                isItemEqualToValue={(a: GiftCard, b: GiftCard) => a.id === b.id}
                value={selected}
                onValueChange={(card: GiftCard | null) => {
                  field.handleChange(card?.code ?? '')
                  // Spending the whole remaining balance is the common case,
                  // and the summary caps it at the invoice total anyway.
                  form.setFieldValue(
                    `${base}.amount` as never,
                    (card?.balance ?? '') as never,
                  )
                }}
              >
                <ComboboxInput
                  id={field.name}
                  placeholder="Search gift card by code..."
                  className="w-full"
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>No gift cards with a balance.</ComboboxEmpty>
                  <ComboboxList>
                    {(card: GiftCard) => (
                      <ComboboxItem key={card.id} value={card}>
                        {cardLabel(card)}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )
        }}
      </form.Field>

      <div className="w-36">
        <NumberField
          form={form}
          name={`${base}.amount`}
          label={`Apply (${CURRENCY})`}
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
