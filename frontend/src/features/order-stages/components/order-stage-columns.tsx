import { Link } from '@tanstack/react-router'
import { PencilIcon, PowerIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import type { OrderStage } from '../types/order-stage'

export const DELIVERIES_ONLY_LABEL = 'Deliveries only'
export const EVERY_ORDER_LABEL = 'Every order'

export function appliesToLabel(stage: OrderStage): string {
  return stage.requiresDelivery ? DELIVERIES_ONLY_LABEL : EVERY_ORDER_LABEL
}

// Shared by the "Applies to" and "Status" columns: both filter an array-valued
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

export const getOrderStageColumns = (
  onToggleActive: (stage: OrderStage) => void,
  isToggling: boolean,
): ColumnDef<OrderStage, any>[] => [
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
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Stage" />
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
      label: 'Stage',
      placeholder: 'Filter stage...',
      variant: 'text',
    },
  },
  {
    id: 'appliesTo',
    accessorFn: (stage) => [appliesToLabel(stage)],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Applies To" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline">{appliesToLabel(row.original)}</Badge>
    ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Applies To',
      placeholder: 'Filter...',
      variant: 'multiSelect',
      options: [
        { label: EVERY_ORDER_LABEL, value: EVERY_ORDER_LABEL },
        { label: DELIVERIES_ONLY_LABEL, value: DELIVERIES_ONLY_LABEL },
      ],
    },
  },
  {
    id: 'status',
    accessorFn: (stage) => [stage.isActive ? 'Active' : 'Retired'],
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
      const stage = row.original
      return (
        <RowActions
          items={[
            {
              label: 'Edit',
              icon: PencilIcon,
              render: (
                <Link
                  to="/order-stages/$stageId/edit"
                  params={{ stageId: stage.id }}
                />
              ),
            },
            {
              label: stage.isActive ? 'Retire' : 'Restore',
              icon: PowerIcon,
              disabled: isToggling,
              onClick: () => onToggleActive(stage),
            },
          ]}
        />
      )
    },
  },
]
