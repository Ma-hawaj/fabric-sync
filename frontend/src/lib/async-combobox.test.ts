import { describe, expect, it } from 'vitest'
import { buildPickerRequestParams } from './async-combobox'

describe('mixed numeric and text picker searches', () => {
  function searchParams(search: string) {
    return buildPickerRequestParams({
      page: 1,
      perPage: 20,
      search,
      searchField: [
        { id: 'orderNumber', type: 'number', prefix: 'ORD-' },
        'customerName',
        'customerMobile',
      ],
    })
  }

  it.each(['101', 'ORD-101', ' ord-101 '])(
    'searches the numeric identifier while preserving customer search for %s',
    (search) => {
      const params = searchParams(search)
      expect(params.get('joinOperator')).toBe('or')
      expect(JSON.parse(params.get('filters')!)).toEqual([
        { id: 'orderNumber', value: '101', variant: 'number', operator: 'eq' },
        {
          id: 'customerName',
          value: search,
          variant: 'text',
          operator: 'iLike',
        },
        {
          id: 'customerMobile',
          value: search,
          variant: 'text',
          operator: 'iLike',
        },
      ])
    },
  )

  it.each(['Ahmed', '+973 3900 1234', 'ORD-', '101abc'])(
    'avoids invalid numeric filters when searching for %s',
    (search) => {
      expect(JSON.parse(searchParams(search).get('filters')!)).toEqual([
        {
          id: 'customerName',
          value: search,
          variant: 'text',
          operator: 'iLike',
        },
        {
          id: 'customerMobile',
          value: search,
          variant: 'text',
          operator: 'iLike',
        },
      ])
    },
  )

  it('keeps the unfiltered initial list for empty search', () => {
    expect(searchParams('').has('filters')).toBe(false)
  })
})
