import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Customer } from '@/features/customers/types/customers'
import {
  existingGuardianCandidates,
  invoiceGuardianCandidates,
} from '../../lib/guardian-candidates'
import type {
  GuardianDraft,
  InvoiceCustomerDraft,
  InvoiceFormApi,
} from '../../types/invoice-form'
import { TextField } from './form-fields'

const NEW_GUARDIAN_VALUE = 'new'

// Always returns a string (never undefined) so the Select stays controlled
// from mount — Base UI warns if a component switches between controlled and
// uncontrolled after the initial render.
function guardianSelectValue(guardian: GuardianDraft): string {
  if (guardian.mode === 'existing') {
    return `existing:${guardian.existingCustomerId}`
  }
  if (guardian.mode === 'invoiceCustomer') {
    return `invoice:${guardian.invoiceCustomerKey}`
  }
  if (guardian.mode === 'new') return NEW_GUARDIAN_VALUE
  return ''
}

function blankGuardian(): GuardianDraft {
  return {
    mode: 'unset',
    existingCustomerId: '',
    invoiceCustomerKey: '',
    name: '',
    nameArabic: '',
    mobileNo: '',
  }
}

interface GuardianFieldProps {
  form: InvoiceFormApi
  customerIndex: number
  existingCustomers: Customer[]
}

export function GuardianField({
  form,
  customerIndex,
  existingCustomers,
}: GuardianFieldProps) {
  const base = `customers[${customerIndex}].guardian`

  return (
    <form.Subscribe
      selector={(state: any) => [
        state.values.customers,
        state.values.customers[customerIndex]?.guardian,
      ]}
    >
      {(subscribed: any) => {
        const [customers, guardian] = subscribed as [
          InvoiceCustomerDraft[],
          GuardianDraft,
        ]
        const invoiceCandidates = invoiceGuardianCandidates(
          customers,
          customerIndex,
          existingCustomers,
        )
        const existingCandidates = existingGuardianCandidates(existingCustomers)

        return (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`${base}-select`}>Guardian</Label>
              <Select
                items={[
                  ...invoiceCandidates,
                  ...existingCandidates,
                  { value: NEW_GUARDIAN_VALUE, label: '+ New Guardian' },
                ]}
                value={guardianSelectValue(guardian)}
                onValueChange={(value: string | null) => {
                  if (!value) return
                  if (value === NEW_GUARDIAN_VALUE) {
                    form.setFieldValue(
                      base as never,
                      {
                        ...blankGuardian(),
                        mode: 'new',
                      } as never,
                    )
                    return
                  }
                  const [kind, id] = value.split(':')
                  form.setFieldValue(
                    base as never,
                    {
                      ...blankGuardian(),
                      mode:
                        kind === 'existing' ? 'existing' : 'invoiceCustomer',
                      existingCustomerId: kind === 'existing' ? id : '',
                      invoiceCustomerKey: kind === 'invoice' ? id : '',
                    } as never,
                  )
                }}
              >
                <SelectTrigger id={`${base}-select`} className="w-full">
                  <SelectValue placeholder="Select guardian..." />
                </SelectTrigger>
                <SelectContent>
                  {invoiceCandidates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>On This Invoice</SelectLabel>
                      {invoiceCandidates.map((candidate) => (
                        <SelectItem
                          key={candidate.value}
                          value={candidate.value}
                        >
                          {candidate.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {existingCandidates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Existing Customers</SelectLabel>
                      {existingCandidates.map((candidate) => (
                        <SelectItem
                          key={candidate.value}
                          value={candidate.value}
                        >
                          {candidate.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectItem value={NEW_GUARDIAN_VALUE}>
                    + New Guardian
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {guardian.mode === 'new' && (
              <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">
                  This guardian will be created as a customer, without an order,
                  when the invoice is saved.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    form={form}
                    name={`${base}.name`}
                    label="Guardian Full Name"
                  />
                  <TextField
                    form={form}
                    name={`${base}.nameArabic`}
                    label="Guardian Name (Arabic)"
                  />
                </div>
                <TextField
                  form={form}
                  name={`${base}.mobileNo`}
                  label="Guardian Phone"
                />
              </div>
            )}
          </div>
        )
      }}
    </form.Subscribe>
  )
}
