import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { NumberField, TextField } from '@/components/form/fields'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { useAllCustomers } from '@/features/customers/hooks/use-customers'
import { CURRENCY } from '@/lib/currency'
import { useCreateGiftCard } from './hooks/use-create-gift-card'
import { giftCardFormSchema } from './lib/gift-card-schema'
import { createEmptyGiftCardForm } from './types/gift-card-form'
import type { Customer } from '@/features/customers/types/customers'

export function GiftCardFormPage() {
  const navigate = useNavigate()
  const { data: customers } = useAllCustomers()
  const createGiftCard = useCreateGiftCard()

  const form = useForm({
    defaultValues: createEmptyGiftCardForm(),
    validators: { onSubmit: giftCardFormSchema },
    onSubmit: async ({ value }) => {
      const pending = createGiftCard.mutateAsync(value)

      toast.promise(pending, {
        loading: 'Issuing gift card...',
        success: (card) =>
          `${card.code} was issued for ${CURRENCY} ${card.initialAmount.toFixed(2)}.`,
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'A gift card with this code already exists.'
            : 'Could not issue this gift card. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      await navigate({ to: '/gift-cards' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Issue Gift Card</h1>
        <p className="text-muted-foreground">
          Issues a card without a sale, for a comp or a replacement. Selling one
          to a customer is done from the invoice form instead.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="max-w-xl space-y-6"
      >
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField form={form} name="code" label="Code" />
            <NumberField
              form={form}
              name="amount"
              label="Amount"
              unit={CURRENCY}
            />
          </div>

          <form.Field name="customerId">
            {(field) => {
              const selected =
                customers.find((c) => c.id === field.state.value) ?? null
              return (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={field.name}>
                    Customer (optional)
                  </FieldLabel>
                  <Combobox
                    items={customers}
                    itemToStringLabel={(customer: Customer) =>
                      `${customer.name} — ${customer.mobileNo}`
                    }
                    isItemEqualToValue={(a: Customer, b: Customer) =>
                      a.id === b.id
                    }
                    value={selected}
                    onValueChange={(customer: Customer | null) =>
                      field.handleChange(customer?.id ?? '')
                    }
                  >
                    <ComboboxInput
                      id={field.name}
                      placeholder="Search customer..."
                      className="w-full"
                      showClear
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No customers found.</ComboboxEmpty>
                      <ComboboxList>
                        {(customer: Customer) => (
                          <ComboboxItem key={customer.id} value={customer}>
                            {customer.name} — {customer.mobileNo}
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

          <TextField
            form={form}
            name="expiresOn"
            label="Expires On (optional)"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank for a card that never expires. A card is still
            redeemable on its expiry date itself.
          </p>
        </div>

        <form.Subscribe
          selector={(state) =>
            [state.submissionAttempts, state.isValid] as const
          }
        >
          {([submissionAttempts, isValid]) =>
            submissionAttempts > 0 &&
            !isValid && (
              <p className="text-sm font-medium text-destructive">
                Please fix the highlighted fields before saving.
              </p>
            )
          }
        </form.Subscribe>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/gift-cards' })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={createGiftCard.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
