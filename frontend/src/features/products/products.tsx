import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { useLocations } from '@/features/locations/hooks/use-locations'
import { getProductColumns } from './components/product-columns'
import { useProducts } from './hooks/use-products'
import { useUpdateProduct } from './hooks/use-update-product'
import type { Product } from './types/product'

export function ProductsPage() {
  const { data: products = [], isLoading } = useProducts()
  // Unfiltered on purpose: this facet lists where stock already sits, so a
  // since-deactivated location should stay selectable here.
  const { data: locations = [] } = useLocations()
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

  const { table } = useDataTable({
    data: products,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">
            Finished goods sold as-is, priced per unit and stocked per location
            — separate from the materials a tailoring order consumes.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/products/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Product
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading products...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
