import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { localDateString } from '@/lib/date'
import { useDataTable } from '@/hooks/use-data-table'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar'
import { getGiftCardColumns } from './components/gift-card-columns'
import { useGiftCards } from './hooks/use-gift-cards'
import { useUpdateGiftCard } from './hooks/use-update-gift-card'
import type { GiftCard } from './types/gift-card'

export function GiftCardsPage() {
  const updateGiftCard = useUpdateGiftCard()
  const today = localDateString()

  const toggleActive = React.useCallback(
    (card: GiftCard) => {
      const pending = updateGiftCard.mutateAsync({
        id: card.id,
        isActive: !card.isActive,
      })
      toast.promise(pending, {
        loading: card.isActive
          ? `Voiding ${card.code}...`
          : `Restoring ${card.code}...`,
        success: (updated) =>
          updated.isActive
            ? `${updated.code} can be spent again.`
            : `${updated.code} was voided and can no longer be spent.`,
        error: 'Could not update this gift card. Please try again.',
      })
    },
    [updateGiftCard],
  )

  const columns = React.useMemo(
    () => getGiftCardColumns(toggleActive, updateGiftCard.isPending, today),
    [toggleActive, updateGiftCard.isPending, today],
  )

  const { searchParams } = useListParams({ columns })
  const {
    data: giftCards,
    pageCount,
    total,
    isLoading,
  } = useGiftCards(searchParams)

  const { table } = useDataTable({
    data: giftCards,
    columns,
    pageCount,
    rowCount: total,
    enableAdvancedFilter: true,
    initialState: { columnPinning: { right: ['actions'] } },
  })

  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-3 [&>:first-child]:shrink-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Gift Cards{' '}
            <span className="ms-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
              {isLoading ? '…' : total.toLocaleString()} records
            </span>
          </h1>
          <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            Balances, expiry dates and card status.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/gift-cards/new" />}>
          <PlusIcon className="h-4 w-4" />
          Issue Gift Card
        </Button>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableAdvancedToolbar
          table={table}
          defaultSearchColumnId="code"
          quickFilter={{ columnId: 'status', allLabel: 'All statuses' }}
        />
      </DataTable>
    </div>
  )
}
