import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { InvoiceForm } from './invoice-form'
import { useInvoiceEdit } from './hooks/use-invoice-edit'
import { useUpdateInvoice } from './hooks/use-update-invoice'
import { mapInvoiceEditToForm } from './lib/invoice-edit-mapper'

export function InvoiceEditPage({ invoiceId }: { invoiceId: string }) {
  const { data: edit, isLoading, isError } = useInvoiceEdit(invoiceId)
  const updateInvoice = useUpdateInvoice(invoiceId)

  const mapped = React.useMemo(
    () => (edit && !edit.editBlockedReason ? mapInvoiceEditToForm(edit) : null),
    [edit],
  )

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
        Could not load this invoice for editing.
      </div>
    )
  }

  if (edit?.editBlockedReason) {
    return (
      <div className="space-y-3 rounded-lg border p-4" role="alert">
        <h1 className="text-lg font-semibold">
          Invoice INV-{edit.invoiceNumber} cannot be edited
        </h1>
        <p className="text-sm text-muted-foreground">
          {edit.editBlockedReason}
        </p>
        <Link
          to="/invoices/$invoiceId"
          params={{ invoiceId }}
          className="text-sm text-info hover:underline"
        >
          View invoice
        </Link>
      </div>
    )
  }

  if (isLoading || !mapped || !edit) {
    return (
      <div className="text-center text-sm text-muted-foreground">
        Loading invoice...
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
      subtitle="Update invoice details or measurements. Previous measurement records and payments are retained."
      saveVerb="Updating"
      savedVerb="updated"
      mutation={updateInvoice}
      seeds={mapped.seeds}
      editing
      invoiceDate={edit.date}
    />
  )
}
