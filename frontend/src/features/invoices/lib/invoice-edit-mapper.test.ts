import { describe, expect, it } from 'vitest'
import { mapInvoiceEditToForm } from './invoice-edit-mapper'
import type { InvoiceEdit } from '../types/invoice-edit'

function editFixture(): InvoiceEdit {
  return {
    id: '0197fdd2-6a67-7000-8000-000000000001',
    invoiceNumber: 42,
    date: '2026-07-19',
    branchId: '0197fdd2-6a67-7000-8000-000000000005',
    branchName: 'Main Branch',
    discount: 0,
    discountUnit: 'amount',
    payments: [],
    customerId: null,
    customers: [
      {
        existingCustomerId: '0197fdd2-6a67-7000-8000-000000000002',
        customerName: 'Ahmed',
        customerMobileNo: '0500000000',
        measurementId: '0197fdd2-6a67-7000-8000-000000000009',
        measurement: {
          date: '2026-07-19',
          lengthFl: 152.5,
          lengthBl: null,
          chest: 108,
          waist: null,
          hips: null,
          shoulder: null,
          sleeveLength: null,
          neck: null,
          openHand: null,
          chestUp: null,
          cuffWidth: null,
          neckWidth: null,
          aramHole: null,
          foWidth: null,
          frantPocketLength: null,
          farntPocketLengthByWidth: null,
          sidePocket: null,
          mobilePocketLengthByWidth: null,
        },
        orders: [
          {
            materialId: '0197fdd2-6a67-7000-8000-000000000003',
            materialName: 'Linen',
            materialUnit: 'meters',
            materialAmount: 2,
            productionLocationId: '0197fdd2-6a67-7000-8000-000000000005',
            productionLocationName: 'Main Branch',
            stockQuantity: 10,
            price: 100,
            thobeType: 'saudi-classic',
            fPocket: null,
            collar: null,
            sleeve: null,
            patti: null,
            moreDetails: null,
          },
        ],
      },
    ],
    products: [
      {
        productId: '0197fdd2-6a67-7000-8000-000000000004',
        productName: 'Musk',
        quantity: 1,
        unitPrice: 25,
        branchId: '0197fdd2-6a67-7000-8000-000000000005',
        branchName: 'Main Branch',
        stockQuantity: 7,
      },
    ],
    giftCards: [],
    giftCardRedemptions: [],
  }
}

describe('mapInvoiceEditToForm', () => {
  it('maps the header back onto the form fields', () => {
    const { values } = mapInvoiceEditToForm(editFixture())

    expect(values.date).toBe('2026-07-19')
    expect(values.receivingBranch).toBe('0197fdd2-6a67-7000-8000-000000000005')
    expect(values.productBranch).toBe('0197fdd2-6a67-7000-8000-000000000005')
    // Zeros read as blank, the way a fresh form does — the payload maps
    // blanks back to zero on save.
    expect(values.discount).toBe('')
    expect(values.payments).toEqual([])
  })

  it('maps customer blocks with measurements and design slots', () => {
    const { values } = mapInvoiceEditToForm(editFixture())

    expect(values.customers).toHaveLength(1)
    const [customer] = values.customers
    expect(customer.mode).toBe('existing')
    expect(customer.existingCustomerId).toBe(
      '0197fdd2-6a67-7000-8000-000000000002',
    )
    expect(customer.measurement.loadedFromId).toBe(
      '0197fdd2-6a67-7000-8000-000000000009',
    )
    expect(customer.measurement.lengthFl).toBe(152.5)
    expect(customer.measurement.chest).toBe(108)
    expect(customer.measurement.waist).toBe('')
    expect(customer.measurement.sidePocket).toBe('')

    expect(customer.orders).toHaveLength(1)
    const [order] = customer.orders
    expect(order.materialId).toBe('0197fdd2-6a67-7000-8000-000000000003')
    expect(order.materialAmount).toBe(2)
    expect(order.productionLocationId).toBe(
      '0197fdd2-6a67-7000-8000-000000000005',
    )
    expect(order.price).toBe(100)
    expect(order.thobeType).toBe('saudi-classic')
    expect(order.collar).toBe('')
  })

  it('maps product lines and gift card blocks', () => {
    const { values } = mapInvoiceEditToForm(editFixture())

    expect(values.products).toHaveLength(1)
    expect(values.products[0].productId).toBe(
      '0197fdd2-6a67-7000-8000-000000000004',
    )
    expect(values.products[0].quantity).toBe(1)
    expect(values.products[0].unitPrice).toBe(25)
    expect(values.giftCards).toHaveLength(0)
    expect(values.redemptions).toHaveLength(0)
  })

  it('seeds picker rows and labels from the loaded invoice', () => {
    const { seeds } = mapInvoiceEditToForm(editFixture())

    expect(
      seeds.customers.get('0197fdd2-6a67-7000-8000-000000000002')?.name,
    ).toBe('Ahmed')
    expect(
      seeds.customerLabels.get('0197fdd2-6a67-7000-8000-000000000002'),
    ).toBe('Ahmed — 0500000000')
    expect(
      seeds.materials.get('0197fdd2-6a67-7000-8000-000000000003'),
    ).toMatchObject({ name: 'Linen', unit: 'meters' })
    expect(
      seeds.products.get('0197fdd2-6a67-7000-8000-000000000004'),
    ).toMatchObject({ name: 'Musk', unitPrice: 25 })
    // The seeded material carries the stored location with live stock, so
    // the "Made At" picker resolves without re-picking.
    expect(
      seeds.materials.get('0197fdd2-6a67-7000-8000-000000000003')?.locations,
    ).toEqual([
      {
        locationId: '0197fdd2-6a67-7000-8000-000000000005',
        location: 'Main Branch',
        quantity: 10,
      },
    ])
    expect(seeds.soldFromBranchName).toBe('Main Branch')
  })

  it('leaves the product branch blank when there are no product lines', () => {
    const fixture = editFixture()
    fixture.products = []
    const { values, seeds } = mapInvoiceEditToForm(fixture)

    expect(values.productBranch).toBe('')
    expect(seeds.soldFromBranchName).toBe('')
  })
})
