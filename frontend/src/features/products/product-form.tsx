import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { NumberField, TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { ApiError } from '@/lib/api'
import { StockEntryRow } from '@/features/inventory/components/stock-entry-row'
import { useLocations } from '@/features/locations/hooks/use-locations'
import { stockLocations } from '@/features/locations/lib/location-filters'
import { CURRENCY } from '@/lib/currency'
import { useCreateProduct } from './hooks/use-create-product'
import { useProducts } from './hooks/use-products'
import { useUpdateProduct } from './hooks/use-update-product'
import { stockEntriesPayload } from './lib/product-payload'
import { productFormSchema } from './lib/product-schema'
import {
  createEmptyProductForm,
  createEmptyProductStockEntry,
  productToFormValues,
} from './types/product-form'
import type { Product } from './types/product'

export function ProductFormPage({ productId }: { productId?: string }) {
  const { data: products = [], isLoading } = useProducts()
  const existing = productId
    ? products.find((product) => product.id === productId)
    : undefined

  if (productId && isLoading) {
    return <LoadingIndicator label="Loading product..." />
  }

  if (productId && !existing) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        That product could not be found.
      </div>
    )
  }

  // Keyed so the form re-initialises if the underlying product changes —
  // defaultValues is only read on the first render.
  return <ProductForm key={existing?.id ?? 'new'} existing={existing} />
}

function ProductForm({ existing }: { existing?: Product }) {
  const navigate = useNavigate()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const mutation = existing ? updateProduct : createProduct

  // Stock can only be booked into locations that hold it — a branch that only
  // hands finished orders to customers is not a stock location.
  const { data: allLocations = [] } = useLocations()
  const locations = React.useMemo(
    () => stockLocations(allLocations),
    [allLocations],
  )

  const form = useForm({
    defaultValues: existing
      ? productToFormValues(existing)
      : createEmptyProductForm(),
    validators: { onSubmit: productFormSchema },
    onSubmit: async ({ value }) => {
      const pending = existing
        ? updateProduct.mutateAsync({
            id: existing.id,
            name: value.name,
            sku: value.sku.trim(),
            unitPrice: value.unitPrice === '' ? 0 : value.unitPrice,
            isActive: value.isActive,
            entries: stockEntriesPayload(value.entries),
          })
        : createProduct.mutateAsync(value)

      toast.promise(pending, {
        loading: existing ? 'Saving product...' : 'Adding product...',
        success: (product) =>
          existing
            ? `${product.name} was updated.`
            : `${product.name} was added.`,
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'A product with this SKU already exists.'
            : 'Could not save this product. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      await navigate({ to: '/products' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {existing ? 'Edit Product' : 'Add Product'}
        </h1>
        <p className="text-muted-foreground">
          A product sells at a list price, which the invoice form prefills when
          it is added to a sale.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="max-w-xl space-y-6"
      >
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField form={form} name="name" label="Name" />
            <TextField form={form} name="sku" label="SKU" />
          </div>

          <NumberField
            form={form}
            name="unitPrice"
            label="Price"
            unit={CURRENCY}
          />

          {existing && (
            <form.Field name="isActive">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Status</FieldLabel>
                  <SegmentedOptions
                    id={field.name}
                    options={['Active', 'Inactive']}
                    value={field.state.value ? 'Active' : 'Inactive'}
                    onChange={(label) => field.handleChange(label === 'Active')}
                    columns={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Inactive products stay on this page but stop appearing in
                    the invoice picker.
                  </p>
                </Field>
              )}
            </form.Field>
          )}
        </div>

        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold">
              {existing ? 'Add Stock' : 'Opening Stock'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {existing
                ? 'Quantities entered here are added to what is already on the shelf.'
                : 'Optional — a product can be catalogued before any of it arrives.'}
            </p>
          </div>

          <form.Field name="entries">
            {(entriesField) => (
              <div className="space-y-3">
                {entriesField.state.value.map((entry, index) => (
                  <StockEntryRow
                    key={entry.key}
                    form={form as never}
                    entryIndex={index}
                    locations={locations}
                    removable
                    onRemove={() => entriesField.removeValue(index)}
                  />
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    entriesField.pushValue(createEmptyProductStockEntry())
                  }
                  className="w-full border-dashed"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add a Location
                </Button>
              </div>
            )}
          </form.Field>
        </div>

        <form.Subscribe
          selector={(state) =>
            [state.submissionAttempts, state.isValid] as const
          }
        >
          {([submissionAttempts, isValid]) =>
            submissionAttempts > 0 &&
            !isValid && (
              <p className="text-sm font-medium text-destructive">
                Please fix the highlighted fields before saving.
              </p>
            )
          }
        </form.Subscribe>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/products' })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
