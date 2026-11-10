import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PermissionGuard } from '@/components/permission-guard'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { useDataTable } from '@/hooks/use-data-table'
import { formatBhd, methodLabel, isClosingReadOnly } from '../lib/sales-closing'
import type { BranchExpense, SalesClosing } from '../types/sales-closing'
import { ExpenseForm, VoidExpenseForm } from './till-forms'

export function BranchExpenses({
  report,
  disabled,
}: {
  report: SalesClosing
  disabled: boolean
}) {
  const readOnly = isClosingReadOnly(report)
  const paid = report.expenses.filter((expense) => !expense.voidedAt)
  const total =
    paid.reduce((sum, expense) => sum + Math.round(expense.amount * 1000), 0) /
    1000
  const cash =
    paid
      .filter((expense) => expense.paymentType === 'cash')
      .reduce((sum, expense) => sum + Math.round(expense.amount * 1000), 0) /
    1000
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">2. Paid expenses</h2>
      <p className="text-sm text-muted-foreground">
        Delivery fees and other branch expenses. Active total: BHD{' '}
        {formatBhd(total)} · Paid from cash drawer: BHD {formatBhd(cash)}.
      </p>
      <p className="text-xs text-muted-foreground">
        Only cash expenses reduce expected drawer cash. Benefit/Card expenses
        are listed separately and do not reduce sales terminal receipt totals.
      </p>
      {readOnly ? (
        <p className="text-xs text-muted-foreground">
          Expenses for this day are read-only.
        </p>
      ) : report.opening ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Add paid expense
          </summary>
          <ExpenseForm report={report} disabled={disabled} />
        </details>
      ) : (
        <p className="text-sm text-muted-foreground">
          Save opening cash before recording expenses.
        </p>
      )}
      {report.expenses.length > 0 ? (
        <ExpenseTable report={report} disabled={disabled || readOnly} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No expenses recorded for this branch day.
        </p>
      )}
    </section>
  )
}

function ExpenseTable({
  report,
  disabled,
}: {
  report: SalesClosing
  disabled: boolean
}) {
  const [selected, setSelected] = useState<BranchExpense | null>(null)
  const columns = useMemo<ColumnDef<BranchExpense>[]>(
    () => [
      { accessorKey: 'reason', header: 'Reason', size: 210 },
      {
        accessorKey: 'amount',
        header: 'Amount (BHD)',
        cell: ({ row }) => formatBhd(row.original.amount),
        meta: { align: 'end' },
        size: 130,
      },
      {
        accessorKey: 'paymentType',
        header: 'Paid by',
        cell: ({ row }) => methodLabel(row.original.paymentType),
        size: 100,
      },
      {
        accessorKey: 'paidTo',
        header: 'Paid to',
        cell: ({ row }) => row.original.paidTo || '—',
        size: 150,
      },
      {
        accessorKey: 'reference',
        header: 'Reference',
        cell: ({ row }) => row.original.reference || '—',
        size: 130,
      },
      {
        accessorKey: 'recordedAt',
        header: 'Recorded',
        cell: ({ row }) =>
          new Date(row.original.recordedAt).toLocaleString('en-GB', {
            timeZone: report.timezone,
          }),
        size: 170,
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.voidedAt ? `Voided: ${row.original.voidReason}` : 'Paid',
        size: 170,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          !row.original.voidedAt && (
            <PermissionGuard
              method="POST"
              path="/sales-closing/expenses/ID/void"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setSelected(row.original)}
              >
                Void
              </Button>
            </PermissionGuard>
          ),
        size: 90,
      },
    ],
    [report.timezone, disabled],
  )
  const { table } = useDataTable({
    data: report.expenses,
    columns,
    manualPagination: false,
    manualSorting: false,
    manualFiltering: false,
    getRowId: (row) => row.id,
    queryKeys: {
      page: 'expensePage',
      perPage: 'expensePerPage',
      sort: 'expenseSort',
      filters: 'expenseFilters',
      joinOperator: 'expenseJoin',
    },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  })
  return (
    <div className="space-y-3">
      {selected && !disabled && (
        <VoidExpenseForm expense={selected} onClose={() => setSelected(null)} />
      )}
      <div className="flex h-80 flex-col">
        <DataTable table={table} />
      </div>
    </div>
  )
}
