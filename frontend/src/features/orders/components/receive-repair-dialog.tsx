import * as React from 'react'
import { useState } from 'react'
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
import { useReceiveRepair } from '../hooks/use-receive-repair'
import type { PaymentType, RepairListItem } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

const paymentTypeOptions: { value: PaymentType; label: string }[] = [
  { value: 'benefit', label: 'Benefit' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

interface ReceiveRepairDialogProps {
  repair: RepairListItem | null
  onOpenChange: (open: boolean) => void
}

export function ReceiveRepairDialog({
  repair,
  onOpenChange,
}: ReceiveRepairDialogProps) {
  const receiveRepair = useReceiveRepair()
  const [amount, setAmount] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType | ''>('')

  // Prefill with the quoted charge — staff collecting for the repair usually
  // take exactly that, and a free rework just confirms with zero.
  React.useEffect(() => {
    setAmount(repair && repair.charge > 0 ? String(repair.charge) : '')
    setPaymentType('')
  }, [repair?.id])

  const parsedAmount = amount === '' ? 0 : Number(amount)
  const amountValid =
    amount === '' || (!Number.isNaN(parsedAmount) && parsedAmount >= 0)
  const needsMethod = parsedAmount > 0

  const canConfirm =
    repair &&
    repair.status === 'completed' &&
    amountValid &&
    (!needsMethod || paymentType) &&
    !receiveRepair.isPending

  const handleConfirm = async () => {
    if (!repair || !canConfirm) return

    const pending = receiveRepair.mutateAsync({
      orderId: repair.orderId,
      repairId: repair.id,
      amount: parsedAmount,
      paymentType: needsMethod ? (paymentType as PaymentType) : null,
    })
    toast.promise(pending, {
      loading: 'Marking repair collected...',
      success:
        parsedAmount > 0
          ? 'Repair collected and payment recorded.'
          : 'Repair collected.',
      error: 'Could not collect this repair. Please try again.',
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
      open={repair !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent>
        {repair && (
          <>
            <DialogHeader>
              <DialogTitle>Mark as Collected</DialogTitle>
              <DialogDescription>
                {repair.customerName} — ORD-{repair.orderNumber} ·{' '}
                {repair.reason}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quoted charge</span>
                <span>{currencyFormatter.format(repair.charge)}</span>
              </div>
            </div>

            <Field data-invalid={!amountValid}>
              <Label htmlFor="repair-amount">Collected Now ({CURRENCY})</Label>
              <Input
                id="repair-amount"
                inputMode="decimal"
                placeholder="0.000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <FieldError
                errors={
                  !amountValid ? [{ message: 'Enter a valid amount.' }] : []
                }
              />
            </Field>

            {needsMethod && (
              <div className="space-y-1">
                <Label htmlFor="repair-payment-type">Payment Method</Label>
                <Select
                  items={paymentTypeOptions}
                  value={paymentType}
                  onValueChange={(value: PaymentType) => setPaymentType(value)}
                >
                  <SelectTrigger id="repair-payment-type" className="w-full">
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
            )}

            <p className="text-sm text-muted-foreground">
              The money is recorded on this repair only — the invoice total is
              untouched.
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={receiveRepair.isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                Mark as Collected
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
