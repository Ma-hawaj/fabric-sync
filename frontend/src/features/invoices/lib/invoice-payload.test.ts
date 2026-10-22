import { describe, expect, it } from 'vitest'
import { invoicePayload } from './invoice-payload'
import {
  createEmptyInvoiceForm,
  createEmptyCustomer,
  createEmptyOrder,
} from '../types/invoice-form'

describe('invoice material payload', () => {
  it('saves customer addresses, collection, and urgency and clears a regular surcharge', () => {
    const values = createEmptyInvoiceForm()
    values.isUrgent = true
    values.customers[0].orders[0].urgentCharge = 15
    values.collectionMethod = 'delivery'
    values.customers[0].mode = 'new'
    values.customers[0].address = '  Building 1, Road 2  '
    expect(invoicePayload(values)).toMatchObject({
      isUrgent: true,
      collectionMethod: 'delivery',
      customers: [
        {
          newCustomer: { address: 'Building 1, Road 2' },
          orders: [{ urgentCharge: 15 }],
        },
      ],
    })
    values.isUrgent = false
    expect(invoicePayload(values).customers[0].orders[0].urgentCharge).toBe(0)
    expect(invoicePayload(values)).not.toHaveProperty('urgentCharge')
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
  })
})
