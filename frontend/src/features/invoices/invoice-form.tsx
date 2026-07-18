import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCustomers } from '@/features/customers/hooks/use-customers'
import { CustomerBlock } from './components/invoice-form/customer-block'
import { InvoiceSummary } from './components/invoice-form/invoice-summary'
import { invoiceFormSchema } from './lib/invoice-schema'
import { createEmptyCustomer } from './types/invoice-form'
import type { InvoiceFormValues } from './types/invoice-form'

export function InvoiceFormPage() {
  const navigate = useNavigate()
  const { data: existingCustomers = [] } = useCustomers()

  // A plain type annotation (not `satisfies`) so TFormData widens to
  // InvoiceFormValues' union members (e.g. `discount: number | ''`) rather
  // than the narrower literal types inferred from these particular values —
  // the zod schema below expects the wide type.
  const defaultValues: InvoiceFormValues = {
    date: new Date().toISOString().slice(0, 10),
    receivingBranch: '',
    discount: '',
    discountUnit: 'SAR',
    paymentStatus: 'unpaid',
    amountPaid: '',
    customers: [createEmptyCustomer()],
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: invoiceFormSchema },
    onSubmit: async ({ value }) => {
      // Mocked — no backend endpoint exists yet for creating invoices.
      console.log('Invoice submitted (mocked):', value)
      await navigate({ to: '/invoices' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New Invoice</h1>
        <p className="text-muted-foreground">
          Create a customer order, updating measurements or adding customers as
          needed.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="space-y-6"
      >
        <form.Field name="customers">
          {(customersField) => (
            <div className="space-y-6">
              {customersField.state.value.map((customer, index) => (
                <CustomerBlock
                  key={customer.key}
                  form={form as never}
                  customerIndex={index}
                  customerNumber={index + 1}
                  existingCustomers={existingCustomers}
                  removable={customersField.state.value.length > 1}
                  onRemove={() => customersField.removeValue(index)}
                />
              ))}
              <Button
                variant="outline"
                type="button"
                onClick={() => customersField.pushValue(createEmptyCustomer())}
                className="w-full border-dashed"
              >
                <PlusIcon className="h-4 w-4" />
                Add Customer
              </Button>
            </div>
          )}
        </form.Field>

        <InvoiceSummary
          form={form as never}
          existingCustomers={existingCustomers}
        />

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
            onClick={() => {
              console.log('Invoice saved as draft (mocked):', form.state.values)
              void navigate({ to: '/invoices' })
            }}
          >
            Save Draft
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            Print
          </Button>
          <Button type="submit">Save &amp; Send</Button>
        </div>
      </form>
    </div>
  )
}
