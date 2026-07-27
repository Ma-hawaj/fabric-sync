import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NumberField } from '@/components/form/fields'
import {
  productOptionLabel,
  productStockAt,
} from '@/features/products/types/product'
import type { Product } from '@/features/products/types/product'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'

interface ProductBlockProps {
  form: InvoiceFormApi
  lineIndex: number
  products: Product[]
  /** The location stock comes off, used to show what is actually available. */
  branchId: string
  branchName: string
  onRemove: () => void
}

export function ProductBlock({
  form,
  lineIndex,
  products,
  branchId,
  branchName,
  onRemove,
}: ProductBlockProps) {
  const base = `products[${lineIndex}]`

  return (
    <div className="flex items-start gap-3">
      <form.Field name={`${base}.productId` as never}>
        {(field: any) => {
          const selected =
            products.find((product) => product.id === field.state.value) ?? null
          const available = selected ? productStockAt(selected, branchId) : null

          return (
            <Field
              data-invalid={field.state.meta.errors.length > 0}
              className="flex-1"
            >
              <FieldLabel htmlFor={field.name}>Product</FieldLabel>
              <Combobox
                items={products}
                itemToStringLabel={productOptionLabel}
                isItemEqualToValue={(a: Product, b: Product) => a.id === b.id}
                value={selected}
                onValueChange={(product: Product | null) => {
                  field.handleChange(product?.id ?? '')
                  // Prefill the price from the catalog; staff can still
                  // override it on the line.
                  form.setFieldValue(
                    `${base}.unitPrice` as never,
                    (product?.unitPrice ?? '') as never,
                  )
                }}
              >
                <ComboboxInput
                  id={field.name}
                  placeholder="Search product by name or SKU..."
                  className="w-full"
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>No products found.</ComboboxEmpty>
                  <ComboboxList>
                    {(product: Product) => (
                      <ComboboxItem key={product.id} value={product}>
                        {productOptionLabel(product)}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {selected && branchId && (
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
