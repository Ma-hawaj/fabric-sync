import type { Customer } from '@/features/customers/types/customers'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'
import type { Material } from '../types/materials'
import type { Product } from '@/features/products/types/product'
import type { InvoiceEdit, InvoiceEditMeasurement } from '../types/invoice-edit'
import type {
  GiftCardRedemptionDraft,
  InvoiceCustomerDraft,
  InvoiceFormValues,
  InvoiceGiftCardDraft,
  InvoiceOrderDraft,
  InvoiceProductDraft,
} from '../types/invoice-form'

function nullToBlank(value: string | null): string {
  return value ?? ''
}

function measurementToDraft(
  measurement: InvoiceEditMeasurement,
  measurementId: string | null,
): MeasurementDraft {
  return {
    loadedFromId: measurementId,
    date: measurement.date,
    lengthFl: measurement.lengthFl ?? '',
    lengthBl: measurement.lengthBl ?? '',
    chest: measurement.chest ?? '',
    waist: measurement.waist ?? '',
    hips: measurement.hips ?? '',
    shoulder: measurement.shoulder ?? '',
    sleeveLength: measurement.sleeveLength ?? '',
    neck: measurement.neck ?? '',
    openHand: measurement.openHand ?? '',
    chestUp: measurement.chestUp ?? '',
    cuffWidth: measurement.cuffWidth ?? '',
    neckWidth: measurement.neckWidth ?? '',
    aramHole: measurement.aramHole ?? '',
    foWidth: measurement.foWidth ?? '',
    frantPocketLength: measurement.frantPocketLength ?? '',
    farntPocketLengthByWidth: nullToBlank(measurement.farntPocketLengthByWidth),
    sidePocket: nullToBlank(measurement.sidePocket),
    mobilePocketLengthByWidth: nullToBlank(
      measurement.mobilePocketLengthByWidth,
    ),
  }
}

/**
 * Rows the pickers handed over on the way in, rebuilt from the edit payload
 * so the form opens labelled the way it was saved: picker display text,
 * summary line labels, the "Made At" options, and the availability hints all
 * read off these without a second query.
 */
export interface InvoiceEditSeeds {
  customers: Map<string, Customer>
  materials: Map<string, Material>
  products: Map<string, Product>
  customerLabels: Map<string, string>
  materialLabels: Map<string, string>
  productLabels: Map<string, string>
  locationLabels: Map<string, string>
  soldFromBranchName: string
}

function customerLabel(name: string, mobileNo: string): string {
  return `${name} — ${mobileNo}`
}

export function mapInvoiceEditToForm(edit: InvoiceEdit): {
  values: InvoiceFormValues
  seeds: InvoiceEditSeeds
} {
  const seeds: InvoiceEditSeeds = {
    customers: new Map(),
    materials: new Map(),
    products: new Map(),
    customerLabels: new Map(),
    materialLabels: new Map(),
    productLabels: new Map(),
    locationLabels: new Map(),
    soldFromBranchName: '',
  }

  if (edit.branchId) {
    seeds.locationLabels.set(edit.branchId, edit.branchName ?? '')
  }

  const customers: InvoiceCustomerDraft[] = edit.customers.map((block) => {
    seeds.customers.set(block.existingCustomerId, {
      id: block.existingCustomerId,
      name: block.customerName,
      mobileNo: block.customerMobileNo,
      measurements: [],
    })
    seeds.customerLabels.set(
      block.existingCustomerId,
      customerLabel(block.customerName, block.customerMobileNo),
    )

    const orders: InvoiceOrderDraft[] = block.orders.map((line) => {
      if (!seeds.materials.has(line.materialId)) {
        seeds.materials.set(line.materialId, {
          id: line.materialId,
          name: line.materialName,
          sku: null,
          unit: line.materialUnit,
          locations:
            line.productionLocationId == null
              ? []
              : [
                  {
                    locationId: line.productionLocationId,
                    location: line.productionLocationName ?? '',
                    quantity: line.stockQuantity ?? 0,
                  },
                ],
        })
      }
      seeds.materialLabels.set(line.materialId, line.materialName)
      if (line.productionLocationId) {
        seeds.locationLabels.set(
          line.productionLocationId,
          line.productionLocationName ?? '',
        )
      }

      return {
        key: crypto.randomUUID(),
        thobeType: nullToBlank(line.thobeType),
        fPocket: nullToBlank(line.fPocket),
        collar: nullToBlank(line.collar),
        sleeve: nullToBlank(line.sleeve),
        patti: nullToBlank(line.patti),
        moreDetails: nullToBlank(line.moreDetails),
        materialId: line.materialId,
        materialAmount: line.materialAmount,
        productionLocationId: line.productionLocationId ?? '',
        price: line.price,
      }
    })

    return {
      key: crypto.randomUUID(),
      mode: 'existing',
      existingCustomerId: block.existingCustomerId,
      name: '',
      mobileNo: '',
      measurement: measurementToDraft(block.measurement, block.measurementId),
      orders,
    }
  })

  // Every product line sells from one "Sold From" location — the create form
  // stamps a single branch onto all of them, so the edit reads it back off
  // the first line that names one.
  const productBranch =
    edit.products.find((line) => line.branchId)?.branchId ?? ''
  const soldFrom = edit.products.find((line) => line.branchId)
  seeds.soldFromBranchName = soldFrom?.branchName ?? ''
  if (soldFrom?.branchId) {
    seeds.locationLabels.set(soldFrom.branchId, soldFrom.branchName ?? '')
  }

  const products: InvoiceProductDraft[] = edit.products.map((line) => {
    if (line.productId && !seeds.products.has(line.productId)) {
      seeds.products.set(line.productId, {
        id: line.productId,
        name: line.productName,
        sku: null,
        unitPrice: line.unitPrice,
        isActive: true,
        locations:
          line.branchId == null
            ? []
            : [
                {
                  locationId: line.branchId,
                  location: line.branchName ?? '',
                  quantity: line.stockQuantity ?? 0,
                },
              ],
      })
    }
    if (line.productId) {
      seeds.productLabels.set(line.productId, line.productName)
    }

    return {
      key: crypto.randomUUID(),
      productId: line.productId ?? '',
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }
  })

  const giftCards: InvoiceGiftCardDraft[] = edit.giftCards.map((line) => ({
    key: crypto.randomUUID(),
    code: line.code,
    amount: line.amount,
    expiresOn: line.expiresOn ?? '',
  }))

  const redemptions: GiftCardRedemptionDraft[] = edit.giftCardRedemptions.map(
    (line) => ({
      key: crypto.randomUUID(),
      code: line.code,
      amount: line.amount,
    }),
  )

  const values: InvoiceFormValues = {
    date: edit.date,
    receivingBranch: edit.branchId ?? '',
    customerId: edit.customerId ?? '',
    productBranch,
    // A zero discount or advance reads as blank, the way a fresh form does —
    // the payload maps blanks back to zero on save.
    discount: edit.discount === 0 ? '' : edit.discount,
    discountUnit: edit.discountUnit,
    paymentStatus: edit.paymentStatus,
    amountPaid: edit.amountPaid === 0 ? '' : edit.amountPaid,
    paymentType: edit.paymentType ?? '',
    customers,
    products,
    giftCards,
    redemptions,
  }

  return { values, seeds }
}
