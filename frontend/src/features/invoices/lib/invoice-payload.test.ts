import { describe, expect, it } from 'vitest'
import { invoicePayload } from './invoice-payload'
import {
  createEmptyInvoiceForm,
  createEmptyCustomer,
  createEmptyOrder,
} from '../types/invoice-form'

describe('invoice material payload', () => {
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
            customerBasePrice: 15,
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
        customerBasePrice: 15,
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
    expect(orders[1].customerBasePrice).toBeNull()
  })
})
