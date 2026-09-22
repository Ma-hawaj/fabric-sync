import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getGiftCardColumns } from './components/gift-card-columns'
import { useGiftCards } from './hooks/use-gift-cards'
import { useUpdateGiftCard } from './hooks/use-update-gift-card'
import type { GiftCard } from './types/gift-card'

export function GiftCardsPage() {
  const updateGiftCard = useUpdateGiftCard()
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), [])

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
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gift Cards</h1>
          <p className="text-muted-foreground">
            Stored value customers can spend on any later invoice. Cards are
            usually sold on an invoice; issue one here for a comp or a
            replacement.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/gift-cards/new" />}>
          <PlusIcon className="h-4 w-4" />
          Issue Gift Card
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading gift cards...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
