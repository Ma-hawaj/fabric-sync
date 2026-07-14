import type { ColumnDef } from '@tanstack/react-table'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Order } from '../types/orders'

const MATERIALS = [
  "Bamboo Fiber",
  "Cotton",
  "Cotton Blend",
  "Organic Cotton",
  "Polyester",
  "Recycled Polyester",
  "Spandex Blend",
  "Cashmere Blend",
  "Silk",
  "Wool",
  "Linen",
  "Satin",
  "Velvet",
  "Tweed",
  "Denim",
  "Lace",
  "Corduroy",
  "Hemp",
  "Microfiber",
  "Jacquard",
];

const materialOptions = MATERIALS.map((m) => ({
  label: m,
  value: m,
}));

export const orderColumns: ColumnDef<Order, any>[] = [
  {
    accessorKey: 'invoice',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Invoice" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue('invoice')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<string>(columnId);
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase());
    },
    meta: {
      label: 'Invoice',
      placeholder: 'Filter invoice...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'invoiceDate',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Invoice Date" />
    ),
    cell: ({ row }) => {
      const date = row.getValue<Date>('invoiceDate')
      return <div>{date.toLocaleDateString()}</div>
    },
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<Date>(columnId);
      const time = cellValue.getTime();
      
      if (!Array.isArray(filterValue)) {
        if (typeof filterValue === 'number') {
          return cellValue.toDateString() === new Date(filterValue).toDateString();
        }
        return true;
      }
      
      const [startVal, endVal] = filterValue;
      const start = startVal !== undefined && startVal !== null ? Number(startVal) : undefined;
      const end = endVal !== undefined && endVal !== null ? Number(endVal) : undefined;
      
      if (start !== undefined && !isNaN(start)) {
        const startDate = new Date(start);
        startDate.setHours(0, 0, 0, 0);
        if (time < startDate.getTime()) return false;
      }
      if (end !== undefined && !isNaN(end)) {
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        if (time > endDate.getTime()) return false;
      }
      return true;
    },
    meta: {
      label: 'Invoice Date',
      variant: 'dateRange',
    },
  },
  {
    accessorKey: 'customerName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Customer Name" />
    ),
    cell: ({ row }) => <div>{row.getValue('customerName')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<string>(columnId);
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase());
    },
    meta: {
      label: 'Customer Name',
      placeholder: 'Filter customer...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'customerMobile',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Customer Mobile" />
    ),
    cell: ({ row }) => <div>{row.getValue('customerMobile')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<string>(columnId);
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase());
    },
    meta: {
      label: 'Customer Mobile',
      placeholder: 'Filter mobile...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'measurementLink',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Measurement Link" />
    ),
    cell: ({ row }) => {
      const link = row.getValue<string>('measurementLink')
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto w-auto p-0 text-blue-600 hover:text-blue-700 hover:underline"
        >
          <ExternalLinkIcon className="mr-2 h-4 w-4" />
          View
          {link}
        </Button>
      )
    },
    enableSorting: false,
    enableColumnFilter: false,
  },
  {
    accessorKey: 'material',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Material" />
    ),
    cell: ({ row }) => <div>{row.getValue('material')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      if (!filterValue || (Array.isArray(filterValue) && filterValue.length === 0)) return true;
      const cellValue = row.getValue<string>(columnId);
      return (filterValue as string[]).includes(cellValue);
    },
    meta: {
      label: 'Material',
      placeholder: 'Filter materials...',
      variant: 'multiSelect',
      options: materialOptions,
    },
  },
]
