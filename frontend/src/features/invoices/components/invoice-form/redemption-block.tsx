import * as React from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/form/fields'
import { useGiftCardByCode } from '@/features/gift-cards/hooks/use-gift-card-by-code'
import { giftCardStatus } from '@/features/gift-cards/lib/gift-card-status'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'

// Matches normalize_code in the Rust service, so what staff type resolves to
// the same card the backend will find when the invoice is saved.
function normalizeCode(code: string) {
  return code.trim().toUpperCase()
}

interface RedemptionBlockProps {
  form: InvoiceFormApi
  lineIndex: number
  /** The invoice date — expiry is checked against it, not against today. */
  date: string
  onRemove: () => void
}

export function RedemptionBlock({
  form,
  lineIndex,
  date,
  onRemove,
}: RedemptionBlockProps) {
  const base = `redemptions[${lineIndex}]`

  // Looked up on a debounce rather than per keystroke; the field itself stays
  // the source of truth for what gets submitted.
  const [lookupCode, setLookupCode] = React.useState('')
  const scheduleLookup = useDebouncedCallback(
    (code: string) => setLookupCode(code),
    400,
  )

  const { data: card, isFetching } = useGiftCardByCode(lookupCode)
  const status = card ? giftCardStatus(card, date) : null

  // Prefilling the full remaining balance is the common case; only do it once
  // per resolved card so it doesn't fight a hand-typed amount.
  const prefilledFor = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!card || status !== 'Active' || prefilledFor.current === card.id) return
    prefilledFor.current = card.id
    form.setFieldValue(`${base}.amount` as never, card.balance as never)
  }, [card, status, form, base])

  function hint() {
    if (!lookupCode) return 'Enter the code printed on the customer’s card.'
    if (isFetching) return 'Checking…'
    if (!card) return 'No gift card with this code.'

    switch (status) {
      case 'Voided':
        return 'This card has been voided and cannot be spent.'
      case 'Spent':
        return 'This card has no balance left.'
      case 'Expired':
        return `This card expired on ${card.expiresOn}.`
      default:
        return `${CURRENCY} ${card.balance.toFixed(2)} available.`
    }
  }

  const unusable = Boolean(lookupCode) && !isFetching && status !== 'Active'

  return (
    <div className="flex items-start gap-3">
      <form.Field name={`${base}.code` as never}>
        {(field: any) => (
          <Field
            data-invalid={field.state.meta.errors.length > 0 || unusable}
            className="flex-1"
          >
            <FieldLabel htmlFor={field.name}>Gift Card Code</FieldLabel>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              placeholder="e.g. GC-ABC123"
              className="font-mono"
              autoComplete="off"
              aria-invalid={field.state.meta.errors.length > 0 || unusable}
              onBlur={field.handleBlur}
              onChange={(event) => {
                const raw = event.target.value
                field.handleChange(normalizeCode(raw))
                scheduleLookup(normalizeCode(raw))
              }}
            />
            <p
              className={
                unusable
                  ? 'text-xs text-destructive'
                  : 'text-xs text-muted-foreground'
              }
            >
              {hint()}
            </p>
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
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
