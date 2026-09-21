import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import type { Customer } from '../types/customers'
import { EyeIcon, PrinterIcon } from 'lucide-react'

export const getCustomerColumns = (
  onViewDetails: (customer: Customer) => void,
  onPrint: (customer: Customer) => void,
): ColumnDef<Customer, any>[] => [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="ID" />
    ),
    cell: ({ row }) => (
      <div className="font-mono text-muted-foreground">
        {row.getValue('id')}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'ID',
      placeholder: 'Filter ID...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Name" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue('name')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Name',
      placeholder: 'Filter name...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'mobileNo',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Phone Number" />
    ),
    cell: ({ row }) => <div>{row.getValue('mobileNo')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Phone Number',
      placeholder: 'Filter phone...',
      variant: 'text',
    },
  },
  {
    id: 'actions',
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
