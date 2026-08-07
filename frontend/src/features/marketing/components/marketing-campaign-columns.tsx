import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Campaign } from '../types/campaign'

function recipientCounts(campaign: Campaign) {
  return campaign.recipients.reduce(
    (counts, recipient) => {
      counts[recipient.status] += 1
      return counts
    },
    { pending: 0, sent: 0, failed: 0 },
  )
}

export const campaignColumns: ColumnDef<Campaign, any>[] = [
  {
    id: 'createdAt',
    accessorFn: (campaign) => new Date(campaign.createdAt),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Sent" />
    ),
    cell: ({ row }) => (
      <div>{row.getValue<Date>('createdAt').toLocaleString()}</div>
    ),
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    accessorKey: 'body',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Message" />
    ),
    cell: ({ row }) => (
      <div className="max-w-md truncate">{row.getValue('body')}</div>
    ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Message',
      placeholder: 'Filter message...',
      variant: 'text',
    },
  },
  {
    id: 'recipients',
    header: 'Recipients',
    cell: ({ row }) => {
      const counts = recipientCounts(row.original)
      return (
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary">{counts.sent} sent</Badge>
          {counts.failed > 0 && (
            <Badge variant="destructive">{counts.failed} failed</Badge>
          )}
          {counts.pending > 0 && (
            <Badge variant="outline">{counts.pending} pending</Badge>
          )}
        </div>
      )
    },
    enableSorting: false,
    enableColumnFilter: false,
  },
]
