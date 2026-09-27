import * as React from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NumberField } from '@/components/form/fields'
import {
  productOptionLabel,
  productStockAt,
} from '@/features/products/types/product'
import type { Product } from '@/features/products/types/product'
import type { PickerFilter } from '@/lib/async-combobox'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'

// Products come off the shelf only while they are on sale. A single search
// field (name) rather than name+SKU because the backend joins every filter —
// the search text and this — with one connector, so an OR of two search fields
// cannot be ANDed with an active-only filter.
const ACTIVE_PRODUCT_FILTER: readonly PickerFilter[] = [
  { id: 'isActive', value: true, variant: 'boolean', operator: 'eq' },
]

interface ProductBlockProps {
  form: InvoiceFormApi
  lineIndex: number
  /** The picked row, so the summary can label this line. */
  onProductPicked: (product: Product | null) => void
  /** The row behind a stored id on an edit form, before anything is re-picked. */
  initialProductForId?: (id: string) => Product | null
  /** The label for a stored id whose row isn't loaded yet (edit forms). */
  productLabelForId?: (id: string) => string | null
  /** The location stock comes off, used to show what is actually available. */
  branchId: string
  branchName: string
  onRemove: () => void
}

export function ProductBlock({
  form,
  lineIndex,
  onProductPicked,
  initialProductForId,
  productLabelForId,
  branchId,
  branchName,
  onRemove,
}: ProductBlockProps) {
  const base = `products[${lineIndex}]`
  // The row behind the stored `productId`, remembered from the picker, so both
  // the availability hint and the price prefill have the full product without
  // having downloaded the whole catalog. On an edit form it starts seeded
  // from the loaded invoice.
  const storedProductId = (
    form.state.values as unknown as {
      products?: { productId?: string }[]
    }
  ).products?.[lineIndex]?.productId
  const [picked, setPicked] = React.useState<Product | null>(() =>
    storedProductId ? (initialProductForId?.(storedProductId) ?? null) : null,
  )

  return (
    <div className="flex items-start gap-3">
      <form.Field name={`${base}.productId` as never}>
        {(field: any) => {
          const available = picked ? productStockAt(picked, branchId) : null

          return (
            <Field
              data-invalid={field.state.meta.errors.length > 0}
              className="flex-1"
            >
              <FieldLabel htmlFor={field.name}>Product</FieldLabel>
              <AsyncCombobox<Product>
                id={field.name}
                endpoint="/products"
                queryKey="invoice-product"
                searchField="name"
                filters={ACTIVE_PRODUCT_FILTER}
                toOption={(product) => ({
                  value: product.id,
                  label: productOptionLabel(product),
                })}
                getValueLabel={productLabelForId}
                value={field.state.value || null}
                onValueChange={(id) => field.handleChange(id ?? '')}
                onSelectRow={(product) => {
                  setPicked(product)
                  onProductPicked(product)
                  // Prefill the price from the catalog; staff can still
                  // override it on the line.
                  form.setFieldValue(
                    `${base}.unitPrice` as never,
                    (product?.unitPrice ?? '') as never,
                  )
                }}
                placeholder="Search product by name..."
                emptyMessage="No products found."
              />
              {picked && branchId && (
                <p className="text-xs text-muted-foreground">
                  Available: {available} at {branchName}
                </p>
              )}
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )
        }}
      </form.Field>

      <div className="w-28">
        <NumberField form={form} name={`${base}.quantity`} label="Qty" />
      </div>

      <div className="w-36">
        <NumberField
          form={form}
          name={`${base}.unitPrice`}
          label={`Unit Price (${CURRENCY})`}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onRemove}
        className="mt-6"
        aria-label="Remove product"
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
