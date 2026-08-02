import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { FileDownIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { ApiError } from '@/lib/api'
import { useCustomers } from '@/features/customers/hooks/use-customers'
import { useLocations } from '@/features/locations/hooks/use-locations'
import {
  orderReceivingLocations,
  stockLocations,
} from '@/features/locations/lib/location-filters'
import { useProducts } from '@/features/products/hooks/use-products'
import { CURRENCY } from '@/lib/currency'
import { CustomerBlock } from './components/invoice-form/customer-block'
import { GiftCardBlock } from './components/invoice-form/gift-card-block'
import { InvoiceSummary } from './components/invoice-form/invoice-summary'
import { ProductBlock } from './components/invoice-form/product-block'
import { RedemptionBlock } from './components/invoice-form/redemption-block'
import { useCreateInvoice } from './hooks/use-create-invoice'
import { useMaterials } from './hooks/use-materials'
import { invoiceFormSchema } from './lib/invoice-schema'
import { printInvoiceDocument } from './lib/print-invoice'
import {
  createEmptyCustomer,
  createEmptyGiftCardLine,
  createEmptyInvoiceForm,
  createEmptyProductLine,
  createEmptyRedemption,
} from './types/invoice-form'
import type { InvoiceFormValues } from './types/invoice-form'
import type { Location } from '@/features/locations/types/location'

export function InvoiceFormPage() {
  const navigate = useNavigate()
  const { data: existingCustomers = [] } = useCustomers()
  const { data: materials = [] } = useMaterials()
  // "Receiving Branch" is where the customer collects the finished order, so
  // it lists only locations flagged as receiving orders — a store that just
  // holds material stock is not a collection point.
  const { data: allLocations = [] } = useLocations()
  const branches = React.useMemo(
    () => orderReceivingLocations(allLocations),
    [allLocations],
  )
  // Products come off stock, so they sell from a location that holds it —
  // a different question from where a finished order is collected.
  const sellFromLocations = React.useMemo(
    () => stockLocations(allLocations),
    [allLocations],
  )
  const { data: allProducts = [] } = useProducts()
  const products = React.useMemo(
    () => allProducts.filter((product) => product.isActive),
    [allProducts],
  )
  const productNames = React.useMemo(
    () =>
      Object.fromEntries(
        allProducts.map((product) => [product.id, product.name]),
      ),
    [allProducts],
  )
  const createInvoice = useCreateInvoice()
  // Which of the two submit buttons was pressed. A ref rather than state
  // because it is read once inside onSubmit and must not re-render the form.
  const exportAfterSave = React.useRef(false)

  // A plain type annotation (not `satisfies`) so TFormData widens to
  // InvoiceFormValues' union members (e.g. `discount: number | ''`) rather
  // than the narrower literal types inferred from these particular values —
  // the zod schema below expects the wide type.
  const defaultValues: InvoiceFormValues = createEmptyInvoiceForm()

  const form = useForm({
    defaultValues,
    validators: { onSubmit: invoiceFormSchema },
    onSubmit: async ({ value }) => {
      const pending = createInvoice.mutateAsync(value)
      toast.promise(pending, {
        loading: 'Saving invoice...',
        success: (invoice) =>
          `Invoice saved — total ${CURRENCY} ${invoice.totalPrice.toFixed(2)}.`,
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'A customer with this name and phone number already exists.'
            : 'Could not save this invoice. Please try again.',
      })

      let created
      try {
        created = await pending
      } catch {
        return
      }

      // The old Print button here printed the form itself — inputs, sidebar
      // and all — because before this there was no invoice document to print.
      // There is now, but only once the invoice has an id, which is why this
      // saves first rather than being a button of its own.
      if (exportAfterSave.current) {
        exportAfterSave.current = false
        try {
          await printInvoiceDocument(created.id)
        } catch {
          toast.error('The invoice was saved, but the PDF could not be opened.')
        }
      }

      await navigate({ to: '/invoices' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New Invoice</h1>
        <p className="text-muted-foreground">
          Create a customer order, updating measurements or adding customers as
          needed.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="space-y-6"
      >
        <form.Field name="customers">
          {(customersField) => (
            <div className="space-y-6">
              {customersField.state.value.map((customer, index) => (
                <CustomerBlock
                  key={customer.key}
                  form={form as never}
                  customerIndex={index}
                  customerNumber={index + 1}
                  existingCustomers={existingCustomers}
                  materials={materials}
                  // Removable down to none: an invoice may consist only of
                  // products or gift cards.
                  removable
                  onRemove={() => customersField.removeValue(index)}
                />
              ))}
              <Button
                variant="outline"
                type="button"
                onClick={() => customersField.pushValue(createEmptyCustomer())}
                className="w-full border-dashed"
              >
                <PlusIcon className="h-4 w-4" />
                Add Customer
              </Button>
            </div>
          )}
        </form.Field>

        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">Products</h3>
            <p className="text-xs text-muted-foreground">
              Finished goods sold as-is. These are taxed with the tailoring
              orders and come off stock at the location below.
            </p>
          </div>

          <form.Subscribe selector={(state: any) => state.values.products}>
            {(productLines: InvoiceFormValues['products']) =>
              productLines.length > 0 && (
                <form.Field name={'productBranch' as never}>
                  {(field: any) => {
                    const selected =
                      sellFromLocations.find(
                        (location) => location.id === field.state.value,
                      ) ?? null
                    return (
                      <div className="space-y-1 max-w-sm">
                        <Label htmlFor={field.name}>Sold From</Label>
                        <Combobox
                          items={sellFromLocations}
                          itemToStringLabel={(location: Location) =>
                            location.name
                          }
                          isItemEqualToValue={(a: Location, b: Location) =>
                            a.id === b.id
                          }
                          value={selected}
                          onValueChange={(location: Location | null) =>
                            field.handleChange(location?.id ?? '')
                          }
                        >
                          <ComboboxInput
                            id={field.name}
                            placeholder="Search location..."
                            className="w-full"
                            showClear
                          />
                          <ComboboxContent>
                            <ComboboxEmpty>No locations found.</ComboboxEmpty>
                            <ComboboxList>
                              {(location: Location) => (
                                <ComboboxItem
                                  key={location.id}
                                  value={location}
                                >
                                  {location.name}
                                </ComboboxItem>
                              )}
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                      </div>
                    )
                  }}
                </form.Field>
              )
            }
          </form.Subscribe>

          <form.Field name="products">
            {(productsField) => (
              <div className="space-y-3">
                <form.Subscribe
                  selector={(state: any) => state.values.productBranch}
                >
                  {(productBranch: string) => (
                    <div className="space-y-3">
                      {productsField.state.value.map((line, index) => (
                        <ProductBlock
                          key={line.key}
                          form={form as never}
                          lineIndex={index}
                          products={products}
                          branchId={productBranch}
                          branchName={
                            sellFromLocations.find(
                              (location) => location.id === productBranch,
                            )?.name ?? ''
                          }
                          onRemove={() => productsField.removeValue(index)}
                        />
                      ))}
                    </div>
                  )}
                </form.Subscribe>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    productsField.pushValue(createEmptyProductLine())
                  }
                  className="w-full border-dashed"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add Product
                </Button>
              </div>
            )}
          </form.Field>
        </div>

        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">Gift Cards</h3>
            <p className="text-xs text-muted-foreground">
              Sell a card at face value, or spend one the customer already has.
              Selling stored value is not taxed — VAT is charged when the card
              is spent.
            </p>
          </div>

          <form.Field name="giftCards">
            {(giftCardsField) => (
              <div className="space-y-3">
                {giftCardsField.state.value.map((line, index) => (
                  <GiftCardBlock
                    key={line.key}
                    form={form as never}
                    lineIndex={index}
                    onRemove={() => giftCardsField.removeValue(index)}
                  />
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    giftCardsField.pushValue(createEmptyGiftCardLine())
                  }
                  className="w-full border-dashed"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Sell a Gift Card
                </Button>
              </div>
            )}
          </form.Field>

          <form.Field name="redemptions">
            {(redemptionsField) => (
              <div className="space-y-3">
                <form.Subscribe selector={(state: any) => state.values.date}>
                  {(date: string) => (
                    <div className="space-y-3">
                      {redemptionsField.state.value.map((line, index) => (
                        <RedemptionBlock
                          key={line.key}
                          form={form as never}
                          lineIndex={index}
                          date={date}
                          onRemove={() => redemptionsField.removeValue(index)}
                        />
                      ))}
                    </div>
                  )}
                </form.Subscribe>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    redemptionsField.pushValue(createEmptyRedemption())
                  }
                  className="w-full border-dashed"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Redeem a Gift Card
                </Button>
              </div>
            )}
          </form.Field>
        </div>

        <InvoiceSummary
          form={form as never}
          existingCustomers={existingCustomers}
          branches={branches}
          productNames={productNames}
        />

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
            type="submit"
            variant="outline"
            disabled={createInvoice.isPending}
            onClick={() => {
              exportAfterSave.current = true
            }}
          >
            <FileDownIcon className="h-4 w-4" />
            Save & Export PDF
          </Button>
          <Button type="submit" disabled={createInvoice.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
