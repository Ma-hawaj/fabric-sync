import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { campaignColumns } from './components/marketing-campaign-columns'
import { useCampaigns } from './hooks/use-campaigns'

export function MarketingCampaignsPage() {
  const { data: campaigns = [], isLoading } = useCampaigns()

  const { table } = useDataTable({
    data: campaigns,
    columns: campaignColumns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketing</h1>
          <p className="text-muted-foreground">
            WhatsApp broadcasts sent to customers who opted in to marketing
            messages.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/marketing/new" />}>
          <PlusIcon className="h-4 w-4" />
          New Message
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading campaigns...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
