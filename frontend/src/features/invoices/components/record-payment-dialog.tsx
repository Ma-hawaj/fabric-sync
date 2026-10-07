import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldError } from '@/components/ui/field'
import { NumberField } from '@/components/form/fields'
import { CURRENCY } from '@/lib/currency'
import { useRecordPayment } from '../hooks/use-record-payment'
import {
  createEmptyRecordPaymentForm,
  recordPaymentSchema,
} from '../lib/record-payment-schema'
import type { Invoice, PaymentType } from '../types/invoices'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

const paymentTypeOptions: { value: PaymentType; label: string }[] = [
  { value: 'benefit', label: 'Benefit' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

interface RecordPaymentDialogProps {
  invoice: Invoice | null
  onOpenChange: (open: boolean) => void
}

export function RecordPaymentDialog({
  invoice,
  onOpenChange,
}: RecordPaymentDialogProps) {
  return (
    <Dialog
      open={invoice !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent>
        {invoice && (
          <>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
              <DialogDescription>
                {invoice.customers.map((c) => c.name).join(', ')} —{' '}
                {invoice.materials.join(', ')}
              </DialogDescription>
            </DialogHeader>

            {/* Remounted per invoice so the amount always starts from the
                invoice on screen. */}
            <RecordPaymentForm
              key={invoice.id}
              invoice={invoice}
              onClose={() => onOpenChange(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecordPaymentForm({
  invoice,
  onClose,
}: {
  invoice: Invoice
  onClose: () => void
}) {
  const recordPayment = useRecordPayment()

  const form = useForm({
    defaultValues: {
      ...createEmptyRecordPaymentForm(),
      // Staff settling an invoice usually take everything, and a partial
      // advance just edits the figure down.
      amount: invoice.balanceDue > 0 ? invoice.balanceDue : '',
    },
    validators: { onSubmit: recordPaymentSchema(invoice.balanceDue) },
    onSubmit: async ({ value }) => {
      if (value.amount === '' || value.paymentType === '') return

      const pending = recordPayment.mutateAsync({
        invoiceId: invoice.id,
        amount: value.amount,
        paymentType: value.paymentType,
      })
      toast.promise(pending, {
        loading: 'Recording payment...',
        success: 'Payment recorded.',
        error: 'Could not record this payment. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      onClose()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Invoice Total</span>
          <span>{currencyFormatter.format(invoice.totalPrice)}</span>
        </div>
        {invoice.giftCardRedeemed > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid by gift card</span>
            <span>{currencyFormatter.format(invoice.giftCardRedeemed)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Already Paid</span>
          <span>{currencyFormatter.format(invoice.amountPaid)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Remaining Balance</span>
          <span>{currencyFormatter.format(invoice.balanceDue)}</span>
        </div>
      </div>

      <NumberField form={form} name="amount" label={`Amount (${CURRENCY})`} />

      <form.Field name="paymentType">
        {(field: any) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <Label htmlFor={field.name}>Payment Method</Label>
            <Select
              items={paymentTypeOptions}
              value={field.state.value}
              onValueChange={(value: PaymentType) => field.handleChange(value)}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue placeholder="Select payment method..." />
              </SelectTrigger>
              <SelectContent>
                {paymentTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <p className="text-sm text-muted-foreground">
        Collects money without collecting any order — the garments stay pending
        until they are received.
      </p>

      <form.Subscribe
        selector={(state) => [state.submissionAttempts, state.isValid] as const}
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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={recordPayment.isPending}>
          Record Payment
        </Button>
      </DialogFooter>
    </form>
  )
}
