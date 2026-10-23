import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar'
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import { useListParams } from '@/hooks/use-list-params'
import { getProductColumns } from './components/product-columns'
import { useProducts } from './hooks/use-products'
import { useUpdateProduct } from './hooks/use-update-product'
import type { Product } from './types/product'

export function ProductsPage() {
  // Unfiltered on purpose: this facet lists where stock already sits, so a
  // since-deactivated location should stay selectable here. It comes from its
  // own unpaginated query rather than from the rows on screen, which under
  // server-side paging are only the current page.
  const { data: locations } = useAllLocations()
  const updateProduct = useUpdateProduct()

  const toggleActive = React.useCallback(
    (product: Product) => {
      const pending = updateProduct.mutateAsync({
        id: product.id,
        isActive: !product.isActive,
      })
      toast.promise(pending, {
        loading: product.isActive
          ? `Deactivating ${product.name}...`
          : `Activating ${product.name}...`,
        success: (updated) =>
          updated.isActive
            ? `${updated.name} is on sale again.`
            : `${updated.name} was deactivated and can no longer be sold.`,
        error: 'Could not update this product. Please try again.',
      })
    },
    [updateProduct],
  )

  const columns = React.useMemo(
    () => getProductColumns(toggleActive, updateProduct.isPending, locations),
    [toggleActive, updateProduct.isPending, locations],
  )

  const { searchParams } = useListParams({ columns })
  const {
    data: products,
    pageCount,
    total,
    isLoading,
  } = useProducts(searchParams)

  const { table } = useDataTable({
    data: products,
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
            Products{' '}
            <span className="ms-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
              {isLoading ? '…' : total.toLocaleString()} records
            </span>
          </h1>
          <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            Finished goods, pricing and stock by location.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/products/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Product
        </Button>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableAdvancedToolbar
          table={table}
          defaultSearchColumnId="name"
          quickFilter={{ columnId: 'status', allLabel: 'All statuses' }}
        />
      </DataTable>
    </div>
  )
}
