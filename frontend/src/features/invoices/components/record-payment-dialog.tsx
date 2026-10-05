import * as React from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldError } from '@/components/ui/field'
import { CURRENCY } from '@/lib/currency'
import { useRecordPayment } from '../hooks/use-record-payment'
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
  const recordPayment = useRecordPayment()
  const [amount, setAmount] = React.useState('')
  const [paymentType, setPaymentType] = React.useState<PaymentType | ''>('')

  // Prefill with the whole remaining balance — staff settling an invoice
  // usually take everything, and a partial advance just edits the figure down.
  React.useEffect(() => {
    setAmount(
      invoice && invoice.balanceDue > 0 ? String(invoice.balanceDue) : '',
    )
    setPaymentType('')
  }, [invoice?.id])

  const parsedAmount = amount === '' ? NaN : Number(amount)
  const amountValid =
    amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0
  const overBalance =
    amountValid && invoice ? parsedAmount - invoice.balanceDue > 1e-9 : false

  const canConfirm =
    invoice &&
    amountValid &&
    !overBalance &&
    paymentType &&
    !recordPayment.isPending

  const handleConfirm = async () => {
    if (
      !invoice ||
      !amountValid ||
      overBalance ||
      !paymentType ||
      recordPayment.isPending
    )
      return

    const pending = recordPayment.mutateAsync({
      invoiceId: invoice.id,
      amount: parsedAmount,
      paymentType,
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
    onOpenChange(false)
  }

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

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Total</span>
                <span>{currencyFormatter.format(invoice.totalPrice)}</span>
              </div>
              {invoice.giftCardRedeemed > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Paid by gift card
                  </span>
                  <span>
                    {currencyFormatter.format(invoice.giftCardRedeemed)}
                  </span>
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

            <Field data-invalid={!amountValid || overBalance}>
              <Label htmlFor="record-payment-amount">Amount ({CURRENCY})</Label>
              <Input
                id="record-payment-amount"
                inputMode="decimal"
                placeholder="0.000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <FieldError
                errors={
                  amount === '' || Number.isNaN(parsedAmount)
                    ? [{ message: 'Enter an amount greater than zero.' }]
                    : parsedAmount <= 0
                      ? [{ message: 'Enter an amount greater than zero.' }]
                      : overBalance
                        ? [
                            {
                              message:
                                'More than the invoice\u2019s remaining balance.',
                            },
                          ]
                        : []
                }
              />
            </Field>

            <div className="space-y-1">
              <Label htmlFor="record-payment-type">Payment Method</Label>
              <Select
                items={paymentTypeOptions}
                value={paymentType}
                onValueChange={(value: PaymentType) => setPaymentType(value)}
              >
                <SelectTrigger id="record-payment-type" className="w-full">
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
            </div>

            <p className="text-sm text-muted-foreground">
              Collects money without collecting any order — the garments stay
              pending until they are received.
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={recordPayment.isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                Record Payment
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
