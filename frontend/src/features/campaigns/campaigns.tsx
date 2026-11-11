import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { defineColumns } from '@/lib/define-columns'
import { useListParams } from '@/hooks/use-list-params'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { Button } from '@/components/ui/button'
import { PermissionGuard } from '@/components/permission-guard'
import { useCampaigns, useCampaignCapabilities } from './hooks'
import { businessTime } from './lib/business-time'
import { StateBadge } from './components'
import type { Campaign } from './types'

const columnsFor = (timezone: string) =>
  defineColumns<Campaign>()([
    {
      accessorKey: 'name',
      header: 'Campaign',
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          className="font-medium text-info hover:underline"
          to="/campaigns/$campaignId"
          params={{ campaignId: row.original.id }}
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'state',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => <StateBadge state={row.original.state} />,
    },
    {
      accessorKey: 'sendAt',
      header: 'Sending starts',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.sendAt
          ? `${businessTime(row.original.sendAt, timezone).replace('T', ' ')} (${timezone})`
          : 'Awaiting approval',
    },
    {
      accessorKey: 'expiresAt',
      header: 'Sending deadline',
      enableSorting: false,
      cell: ({ row }) =>
        `${businessTime(row.original.definition.expiresAt, timezone).replace('T', ' ')} (${timezone})`,
    },
  ])
export function CampaignsPage() {
  const capabilities = useCampaignCapabilities()
  const timezone = capabilities.data?.timezone ?? 'Asia/Bahrain'
  const columns = useMemo(() => columnsFor(timezone), [timezone])
  const { searchParams, perPage } = useListParams({ columns })
  const query = useCampaigns(searchParams)
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    pageCount: Math.ceil((query.data?.total ?? 0) / perPage),
    rowCount: query.data?.total ?? 0,
  })
  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prepare promotions, review the audience, and track WhatsApp
            delivery.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/campaign-templates" />}
          >
            Marketing templates
          </Button>
          <PermissionGuard method="POST" path="/campaigns">
            <Button nativeButton={false} render={<Link to="/campaigns/new" />}>
              New campaign
            </Button>
          </PermissionGuard>
        </div>
      </div>
      {query.isError && (
        <p role="alert">
          Could not load campaigns.{' '}
          <button onClick={() => void query.refetch()}>Try again</button>
        </p>
      )}
      <DataTable
        table={table}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
      />
    </div>
  )
}
