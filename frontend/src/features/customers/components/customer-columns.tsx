import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import type { Customer } from '../types/customers'
import { EyeIcon, PencilIcon, PrinterIcon } from 'lucide-react'

export const getCustomerColumns = (
  onViewDetails: (customer: Customer) => void,
  onPrint: (customer: Customer) => void,
): ColumnDef<Customer, any>[] => [
  {
    accessorKey: 'name',
    size: 220,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Name" />
    ),
    cell: ({ row }) => (
      <button
        type="button"
        onClick={() => onViewDetails(row.original)}
        className="font-medium text-info hover:underline"
      >
        {row.getValue('name')}
      </button>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    meta: {
      label: 'Name',
      placeholder: 'Filter name...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'mobileNo',
    size: 150,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Phone Number" />
    ),
    cell: ({ row }) => <div>{row.getValue('mobileNo')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    meta: {
      label: 'Phone Number',
      placeholder: 'Filter phone...',
      variant: 'text',
    },
  },
  {
    id: 'measurementCount',
    header: 'Measurements',
    accessorFn: (customer) => customer.measurements.length,
    meta: { label: 'Measurements', align: 'end' },
    cell: ({ row }) => (
      <div className="text-end tabular-nums">
        {row.original.measurements.length}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: 'invoiceCount',
    header: 'Invoices',
    accessorFn: (customer) => customer.invoices.length,
    meta: { label: 'Invoices', align: 'end' },
    cell: ({ row }) => (
      <div className="text-end tabular-nums">
        {row.original.invoices.length}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: 'actions',
    size: 72,
    meta: { label: 'Actions' },
    header: 'Actions',
    enablePinning: true,
    cell: ({ row }) => {
      const customer = row.original
      return (
        <RowActions
          items={[
            {
              label: 'View Details',
              icon: EyeIcon,
              onClick: () => onViewDetails(customer),
            },
            {
              label: 'Edit',
              icon: PencilIcon,
              render: (
                <Link
                  to="/customers/$customerId/edit"
                  params={{ customerId: customer.id }}
                />
              ),
            },
            ...(customer.measurements.length > 0
              ? [
                  {
                    label: 'Print Measurements',
                    icon: PrinterIcon,
                    onClick: () => onPrint(customer),
                  },
                ]
              : []),
          ]}
        />
      )
    },
  },
]
