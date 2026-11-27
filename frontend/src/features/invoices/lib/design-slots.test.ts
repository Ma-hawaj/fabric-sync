import { describe, expect, it } from 'vitest'
import { designDefaultsFromOptions } from './design-slots'
import {
  createEmptyCustomer,
  createEmptyInvoiceForm,
  createEmptyOrder,
} from '../types/invoice-form'
import type { DesignOption } from '@/features/design-options/types/design-option'

function option(
  category: string,
  slug: string,
  overrides: Partial<DesignOption> = {},
): DesignOption {
  return {
    id: `${category}-${slug}`,
    category,
    slug,
    label: slug,
    cost: 0,
    sortOrder: 1,
    isActive: true,
    isDefault: false,
    hasImage: false,
    imageUrl: '',
    ...overrides,
  }
}

describe('designDefaultsFromOptions', () => {
  it('maps one active default per slot to its invoice field', () => {
    const defaults = designDefaultsFromOptions([
      option('thob_type', 'saudi', { isDefault: true }),
      option('neck', 'china', { isDefault: true }),
      option('emd', '6', { isDefault: true, cost: 5 }),
      option('sleeve', 'straight'),
    ])
    expect(defaults).toEqual({ thobeType: 'saudi', collar: 'china', emd: '6' })
  })

  it('ignores retired defaults and options without a default flag', () => {
    expect(
      designDefaultsFromOptions([
        option('thob_type', 'old', { isActive: false, isDefault: true }),
        option('neck', 'plain'),
      ]),
    ).toEqual({})
  })
})

describe('invoice form defaults', () => {
  it('prefills new orders, customers and invoices from the catalog defaults', () => {
    const defaults = { thobeType: 'saudi', fPocket: 'straight' }
    expect(createEmptyOrder(defaults)).toMatchObject(defaults)
    expect(createEmptyCustomer(defaults).orders[0]).toMatchObject(defaults)
    expect(
      createEmptyInvoiceForm(defaults).customers[0].orders[0],
    ).toMatchObject(defaults)
    expect(createEmptyOrder().thobeType).toBe('')
  })
})
