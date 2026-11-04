import { describe, expect, it } from 'vitest'
import { invoicePayload } from './invoice-payload'
import {
  createEmptyInvoiceForm,
  createEmptyCustomer,
  createEmptyOrder,
  createEmptyGiftCardLine,
  createEmptyPayment,
} from '../types/invoice-form'

it('omits untouched extra entries while preserving the required payment', () => {
  const values = createEmptyInvoiceForm()
  values.payments.push({
    ...createEmptyPayment(),
    amount: 10,
    paymentType: 'cash',
  })
  expect(invoicePayload(values).payments).toEqual([
    { amount: 10, paymentType: 'cash' },
  ])
})

describe('invoice material payload', () => {
  it('keeps the issuing branch independent and sends only the selected fulfilment details', () => {
    const values = createEmptyInvoiceForm()
    values.issuingBranch = 'issuer'
    values.receivingBranch = 'pickup'
    values.deliveryAddress = '  Building 2, Road 3  '
    expect(invoicePayload(values)).toMatchObject({
      issuingBranchId: 'issuer',
      branchId: 'pickup',
      deliveryAddress: null,
    })
    values.collectionMethod = 'delivery'
    expect(invoicePayload(values)).toMatchObject({
      issuingBranchId: 'issuer',
      branchId: null,
      deliveryAddress: 'Building 2, Road 3',
    })
  })
  it('saves customer addresses, collection, and urgency and clears a regular surcharge', () => {
    const values = createEmptyInvoiceForm()
    values.customers[0].orders[0].isUrgent = true
    values.customers[0].orders[0].urgentCharge = 15
    values.collectionMethod = 'delivery'
    values.customers[0].mode = 'new'
    values.customers[0].name = '  Ahmed  '
    values.customers[0].mobileNo = '  33112233  '
    values.customers[0].address = '  Building 1, Road 2  '
    expect(invoicePayload(values)).toMatchObject({
      collectionMethod: 'delivery',
      customers: [
        {
          newCustomer: {
            name: 'Ahmed',
            mobileNo: '33112233',
            address: 'Building 1, Road 2',
          },
          orders: [{ isUrgent: true }],
        },
      ],
    })
    values.customers[0].orders[0].isUrgent = false
    expect(invoicePayload(values).customers[0].orders[0].isUrgent).toBe(false)
    expect(invoicePayload(values).customers[0].orders[0]).not.toHaveProperty(
      'urgentCharge',
    )
    expect(invoicePayload(values)).not.toHaveProperty('isUrgent')
    expect(invoicePayload(values)).not.toHaveProperty('urgentCharge')
  })

  it('includes gift card recipient details without requiring a manual code', () => {
    const values = createEmptyInvoiceForm()
    values.giftCards = [
      {
        ...createEmptyGiftCardLine(),
        amount: 50,
        boughtFor: ' Recipient ',
        recipientPhone: '+97333112233',
      },
    ]
    expect(invoicePayload(values).giftCards).toEqual([
      {
        code: '',
        amount: 50,
        boughtFor: 'Recipient',
        recipientPhone: '+97333112233',
        expiresOn: null,
      },
    ])
  })
  it('sends only the details belonging to each material source', () => {
    const values = createEmptyInvoiceForm()
    values.customers = [
      {
        ...createEmptyCustomer(),
        orders: [
          {
            ...createEmptyOrder(),
            materialSource: 'customer',
            materialId: 'stale-id',
            customerMaterialDescription: '  White linen  ',
            materialAmount: 3,
            price: 9999,
          },
          {
            ...createEmptyOrder(),
            materialId: 'shop-id',
            customerMaterialDescription: 'stale description',
            materialAmount: 2,
          },
        ],
      },
    ]
    expect(invoicePayload(values).customers[0].orders).toEqual([
      expect.objectContaining({
        materialSource: 'customer',
        materialId: null,
        customerMaterialDescription: 'White linen',
        materialAmount: 3,
      }),
      expect.objectContaining({
        materialSource: 'shop',
        materialId: 'shop-id',
        customerMaterialDescription: null,
        materialAmount: 2,
      }),
    ])
    const orders = invoicePayload(values).customers[0].orders
    expect(orders[0]).not.toHaveProperty('price')
    expect(orders[0]).not.toHaveProperty('customerBasePrice')
    expect(orders[1]).not.toHaveProperty('customerBasePrice')
  })
})

it('sends direct material sales without customer or order payloads', () => {
  const values = createEmptyInvoiceForm()
  values.customers = []
  values.materials = [
    {
      key: 'draft',
      materialId: 'mat-1',
      branchId: 'loc-1',
      quantity: 2.5,
      unitPrice: 11,
    },
  ]
  const payload = invoicePayload(values)
  expect(payload.customers).toEqual([])
  expect(payload.materials).toEqual([
    {
      originalItemId: null,
      materialId: 'mat-1',
      branchId: 'loc-1',
      quantity: 2.5,
      unitPrice: 11,
    },
  ])
})
