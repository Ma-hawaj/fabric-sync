import { afterEach, describe, expect, it, vi } from 'vitest'
import { localDateString } from '@/lib/date'
import { toCustomer } from '../types/customers'
import { createEmptyMeasurement } from '../types/measurement-form'
import { measurementFromSnapshot } from '../components/measurement-fields'

afterEach(() => vi.useRealTimers())

describe('customer local calendar dates', () => {
  it('uses the local day for new measurements on either side of midnight', () => {
    vi.useFakeTimers()
    for (const hour of [0, 23]) {
      vi.setSystemTime(new Date(2026, 6, 31, hour, 30))
      expect(localDateString()).toBe('2026-07-31')
      expect(createEmptyMeasurement().date).toBe('2026-07-31')
      expect(measurementFromSnapshot(null).date).toBe('2026-07-31')
    }
  })

  it('parses measurement and target dates locally without changing invoice instants', () => {
    const customer = toCustomer({
      id: 'c1',
      name: 'Ali',
      mobileNo: '123',
      measurements: [{ id: 'm1', customerId: 'c1', date: '2026-07-31' }],
      invoices: [
        {
          id: 'i1',
          invoiceNumber: 1,
          invoiceDate: '2026-07-30T22:30:00Z',
          targetDate: '2026-08-01',
          totalPrice: 10,
          paymentStatus: 'unpaid',
          balanceDue: 10,
        },
      ],
    })
    expect(customer.measurements[0].date).toEqual(new Date(2026, 6, 31))
    expect(customer.invoices[0].targetDate).toEqual(new Date(2026, 7, 1))
    expect(customer.invoices[0].invoiceDate.getTime()).toBe(
      Date.parse('2026-07-30T22:30:00Z'),
    )
  })
})
