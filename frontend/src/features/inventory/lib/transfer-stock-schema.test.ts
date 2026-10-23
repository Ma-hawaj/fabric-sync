import { describe, expect, it } from 'vitest'
import { transferStockSchema } from './transfer-stock-schema'

const schema = transferStockSchema({ a: 10 }, ['a', 'b'])
const valid = { fromLocationId: 'a', toLocationId: 'b', quantity: 3.25 }
describe('stock transfer validation', () => {
  it('allows moving some or all stock into an active destination', () => {
    for (const quantity of [0.01, 3.25, 10])
      expect(schema.safeParse({ ...valid, quantity }).success).toBe(true)
  })
  it('rejects missing, identical, or ineligible locations', () => {
    for (const values of [
      { fromLocationId: '' },
      { fromLocationId: 'missing' },
      { toLocationId: '' },
      { toLocationId: 'a' },
      { toLocationId: 'inactive' },
    ])
      expect(schema.safeParse({ ...valid, ...values }).success).toBe(false)
  })
  it('rejects excess, blank, nonpositive, nonfinite, and unrepresentable quantities', () => {
    for (const quantity of [
      '',
      10.01,
      0,
      -1,
      0.001,
      1.001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])
      expect(schema.safeParse({ ...valid, quantity }).success).toBe(false)
  })
})
