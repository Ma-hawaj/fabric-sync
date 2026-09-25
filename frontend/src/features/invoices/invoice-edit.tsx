import * as React from 'react'
import { InvoiceForm } from './invoice-form'
import { useInvoiceEdit } from './hooks/use-invoice-edit'
import { useUpdateInvoice } from './hooks/use-update-invoice'
import { mapInvoiceEditToForm } from './lib/invoice-edit-mapper'

export function InvoiceEditPage({ invoiceId }: { invoiceId: string }) {
  const { data: edit, isLoading, isError } = useInvoiceEdit(invoiceId)
  const updateInvoice = useUpdateInvoice(invoiceId)

  const mapped = React.useMemo(
    () => (edit ? mapInvoiceEditToForm(edit) : null),
    [edit],
  )

  if (isLoading || !mapped) {
    return (
      <div className="text-center text-sm text-muted-foreground">
        Loading invoice...
      </div>
    )
  }

  if (isError || !edit) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
        Could not load this invoice for editing.
      </div>
    )
  }

  // Keyed by invoice: the form reads defaults once on mount, so a fresh mount
  // per invoice (and per refetch shape) keeps stale values out.
  return (
    <InvoiceForm
      key={edit.id}
      defaultValues={mapped.values}
      title={`Edit Invoice INV-${edit.invoiceNumber}`}
      subtitle="Change the header or line items and save to rebuild the invoice. Paid, received, or in-production invoices cannot be edited."
      saveVerb="Updating"
      savedVerb="updated"
      mutation={updateInvoice}
      seeds={mapped.seeds}
    />
  )
}
