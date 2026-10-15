import { Link } from '@tanstack/react-router'
import { PencilIcon, PowerIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import { apiBaseUrl } from '@/lib/api'
import { designCategoryLabel } from '../lib/design-option-categories'
import type { DesignOption } from '../types/design-option'

// Shared by the "Category" and "Status" columns: both filter an array-valued
// cell against the multiSelect toolbar filter, which hands over a string[].
function matchesAnySelected(cellValue: string[], filterValue: unknown) {
  if (
    !filterValue ||
    (Array.isArray(filterValue) && filterValue.length === 0)
  ) {
    return true
  }
  return (filterValue as string[]).some((value) => cellValue.includes(value))
}

export const getDesignOptionColumns = (
  onToggleActive: (option: DesignOption) => void,
  isToggling: boolean,
): ColumnDef<DesignOption, any>[] => [
  {
    id: 'illustration',
    header: 'Image',
    enableSorting: false,
    enableColumnFilter: false,
    cell: ({ row }) => {
      const option = row.original
      return option.hasImage ? (
        <img
          src={`${apiBaseUrl}${option.imageUrl}`}
          alt=""
          draggable={false}
          className="h-10 w-14 rounded border border-border/60 bg-background object-contain"
        />
      ) : (
        <span className="text-xs text-muted-foreground">Text only</span>
      )
    },
  },
  {
    id: 'category',
    accessorFn: (option) => [designCategoryLabel(option.category)],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Category" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline">
        {designCategoryLabel(row.original.category)}
      </Badge>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Category',
      placeholder: 'Filter...',
      variant: 'multiSelect',
      options: [
        { label: 'Thobe Type', value: 'Thobe Type' },
        { label: 'Front Pocket', value: 'Front Pocket' },
        { label: 'Collar', value: 'Collar' },
        { label: 'Sleeve', value: 'Sleeve' },
        { label: 'Patti', value: 'Patti' },
        { label: 'EMD', value: 'EMD' },
      ],
    },
  },
  {
    accessorKey: 'label',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Label" />
    ),
    cell: ({ row }) => (
      <Link
        to="/design-options/$designOptionId/edit"
        params={{ designOptionId: row.original.id }}
        className="font-medium text-info hover:underline"
      >
        {row.getValue('label')}
      </Link>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Label',
      placeholder: 'Filter label...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'slug',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Id" />
    ),
    cell: ({ row }) => (
      <div className="font-mono text-xs">{row.getValue('slug')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Id',
      placeholder: 'Filter id...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'sortOrder',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Position" />
    ),
    cell: ({ row }) => (
      <div className="font-mono">{row.getValue('sortOrder')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: false,
    meta: { label: 'Position', variant: 'number' },
  },
  {
    id: 'status',
    accessorFn: (option) => [option.isActive ? 'Active' : 'Retired'],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Status" />
    ),
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge variant="secondary">Active</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Retired
        </Badge>
      ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Status',
      placeholder: 'Filter status...',
      variant: 'multiSelect',
      options: [
        { label: 'Active', value: 'Active' },
        { label: 'Retired', value: 'Retired' },
      ],
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    enablePinning: true,
    cell: ({ row }) => {
      const option = row.original
      return (
        <RowActions
          items={[
            {
              label: 'Edit',
              icon: PencilIcon,
              render: (
                <Link
                  to="/design-options/$designOptionId/edit"
                  params={{ designOptionId: option.id }}
                />
              ),
            },
            {
              label: option.isActive ? 'Retire' : 'Restore',
              icon: PowerIcon,
              disabled: isToggling,
              onClick: () => onToggleActive(option),
            },
          ]}
        />
      )
    },
  },
]
