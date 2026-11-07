import { useState } from 'react'
import { toast } from 'sonner'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMergeCustomer } from '../hooks/use-merge-customer'
import {
  CUSTOMER_SEARCH_FIELDS,
  CUSTOMER_SEARCH_PLACEHOLDER,
  customerOptionLabel,
} from '../lib/customer-picker'
import type { Customer } from '../types/customers'

const customerOption = (customer: Customer) => ({
  value: customer.id,
  label: customerOptionLabel(customer),
})

export function MergeCustomerDialog({
  source,
  onClose,
  onMerged,
}: {
  source: Customer
  onClose: () => void
  onMerged: (customer: Customer) => void
}) {
  const [target, setTarget] = useState<Customer | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const merge = useMergeCustomer()
  const sameCustomer = target?.id === source.id
  const canMerge = target && !sameCustomer && confirmed && !merge.isPending

  const submit = () => {
    if (!canMerge) return
    merge.mutate(
      { sourceId: source.id, targetId: target.id },
      {
        onSuccess: (customer) => {
          toast.success(
            `Customer history merged into C-${customer.customerNumber}.`,
          )
          onMerged(customer)
          onClose()
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !merge.isPending && onClose()}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!merge.isPending}>
        <DialogHeader>
          <DialogTitle>Merge duplicate customer</DialogTitle>
          <DialogDescription>
            Combine records only when they belong to the same person. Relatives
            sharing a phone number should stay separate.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border p-3">
            <p className="font-medium">Duplicate to merge</p>
            <p>{customerOptionLabel(source)}</p>
            <p className="text-muted-foreground">
              {source.measurements.length} measurements ·{' '}
              {source.invoices.length} invoices
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="merge-customer-target" className="font-medium">
              Customer to keep
            </label>
            <AsyncCombobox<Customer>
              id="merge-customer-target"
              endpoint="/customers"
              queryKey="merge-customer"
              searchField={CUSTOMER_SEARCH_FIELDS}
              placeholder={CUSTOMER_SEARCH_PLACEHOLDER}
              toOption={customerOption}
              value={target?.id ?? null}
              onValueChange={(value) => {
                if (value === null) setTarget(null)
                setConfirmed(false)
              }}
              onSelectRow={(customer) => {
                setTarget(customer)
                setConfirmed(false)
              }}
              disabled={merge.isPending}
            />
            {sameCustomer && (
              <p role="alert">Choose a different customer to keep.</p>
            )}
          </div>
          {target && !sameCustomer && (
            <div className="rounded-md border p-3">
              <p className="font-medium">Keep {customerOptionLabel(target)}</p>
              <p className="text-muted-foreground">
                {target.measurements.length} measurements ·{' '}
                {target.invoices.length} invoices
              </p>
              <p className="mt-2">
                This record keeps its name, phone, address and customer number.
                Both records’ history and measurement IDs are preserved. Any
                notification opt-out is retained. The duplicate disappears from
                the customer list. You can’t undo this merge in the app.
              </p>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="confirm-customer-merge"
              checked={confirmed}
              onCheckedChange={setConfirmed}
              disabled={!target || sameCustomer || merge.isPending}
            />
            <label htmlFor="confirm-customer-merge">
              I confirm these records belong to the same person.
            </label>
          </div>
          {merge.isError && (
            <p role="alert" className="text-destructive">
              {merge.error.message ||
                'Unable to merge customers. Please try again.'}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={merge.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canMerge}>
            {merge.isPending ? 'Merging...' : 'Merge customers'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
