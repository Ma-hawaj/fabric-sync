import { describe, expect, it } from 'vitest'
import type { ColumnDef } from '@tanstack/react-table'

import {
  buildFilterParsers,
  toApiSearchParams,
  toColumnFilters,
  toFilterDsl,
} from './list-params'

interface Row {
  name: string
  status: string
  totalPrice: number
  invoiceDate: Date
  itemCount: number
  active: boolean
}

const columns: ColumnDef<Row>[] = [
  {
    id: 'name',
    enableColumnFilter: true,
    meta: { label: 'Name', variant: 'text' },
  },
  {
    id: 'status',
    enableColumnFilter: true,
    meta: {
      label: 'Status',
      variant: 'multiSelect',
      options: [
        { label: 'Paid', value: 'paid' },
        { label: 'Unpaid', value: 'unpaid' },
      ],
    },
  },
  {
    id: 'totalPrice',
    enableColumnFilter: true,
    meta: { label: 'Total', variant: 'range' },
  },
  {
    id: 'invoiceDate',
    enableColumnFilter: true,
    meta: { label: 'Date', variant: 'dateRange' },
  },
  {
    id: 'itemCount',
    enableColumnFilter: true,
    meta: { label: 'Items', variant: 'number' },
  },
  {
    id: 'active',
    enableColumnFilter: true,
    meta: { label: 'Active', variant: 'boolean' },
  },
  { id: 'actions' },
]

function dsl(id: string, value: unknown) {
  return toFilterDsl(columns, [{ id, value }])[0]
}

describe('toFilterDsl', () => {
  it('derives the operator each control implies', () => {
    expect(dsl('name', 'ali').operator).toBe('iLike')
    expect(dsl('status', ['paid']).operator).toBe('inArray')
    expect(dsl('itemCount', '3').operator).toBe('eq')
    expect(dsl('active', 'true').operator).toBe('eq')
    expect(dsl('totalPrice', [10, 500]).operator).toBe('isBetween')
    expect(dsl('invoiceDate', [1, 2]).operator).toBe('isBetween')
  })

  it('treats a single value from a range control as an exact match', () => {
    // The date filter emits one timestamp when a single day is picked.
    expect(dsl('invoiceDate', 1785369600000).operator).toBe('eq')
    expect(dsl('totalPrice', 42).operator).toBe('eq')
  })

  it('carries the column variant through so the server can validate it', () => {
    expect(dsl('name', 'ali').variant).toBe('text')
    expect(dsl('status', ['paid']).variant).toBe('multiSelect')
    expect(dsl('totalPrice', [10, 500]).variant).toBe('range')
  })

  it('serializes every value as a string, including numbers and timestamps', () => {
    expect(dsl('itemCount', 3).value).toBe('3')
    expect(dsl('totalPrice', [10, 500]).value).toEqual(['10', '500'])
    expect(dsl('invoiceDate', 1785369600000).value).toBe('1785369600000')
  })

  it('keeps an unset side of a range as a blank rather than dropping it', () => {
    // Position matters: the server reads the pair as [lower, upper].
    expect(dsl('totalPrice', [undefined, 500]).value).toEqual(['', '500'])
    expect(dsl('totalPrice', [10, null]).value).toEqual(['10', ''])
  })

  it('drops filters with nothing selected', () => {
    expect(toFilterDsl(columns, [{ id: 'name', value: '' }])).toHaveLength(0)
    expect(toFilterDsl(columns, [{ id: 'status', value: [] }])).toHaveLength(0)
  })

  it('ignores a filter on a column that declares no variant', () => {
    expect(toFilterDsl(columns, [{ id: 'actions', value: 'x' }])).toHaveLength(
      0,
    )
    expect(toFilterDsl(columns, [{ id: 'nope', value: 'x' }])).toHaveLength(0)
  })
})

describe('toApiSearchParams', () => {
  const base = { page: 2, perPage: 20, sorting: [], filters: [] }

  it('always carries the page and page size', () => {
    const search = toApiSearchParams(base)

    expect(search.get('page')).toBe('2')
    expect(search.get('perPage')).toBe('20')
    expect(search.get('sort')).toBeNull()
    expect(search.get('filters')).toBeNull()
  })

  it('serializes sorting as the JSON the backend parses', () => {
    const search = toApiSearchParams({
      ...base,
      sorting: [{ id: 'name', desc: true }],
    })

    expect(JSON.parse(search.get('sort') ?? '')).toEqual([
      { id: 'name', desc: true },
    ])
  })

  it('serializes filters without the frontend-only filterId', () => {
    const search = toApiSearchParams({
      ...base,
      filters: toFilterDsl(columns, [{ id: 'name', value: 'ali' }]),
    })

    expect(JSON.parse(search.get('filters') ?? '')).toEqual([
      { id: 'name', value: 'ali', variant: 'text', operator: 'iLike' },
    ])
  })

  it('sends the join operator only when it is not the default', () => {
    const filters = toFilterDsl(columns, [{ id: 'name', value: 'ali' }])

    expect(
      toApiSearchParams({ ...base, filters, joinOperator: 'and' }).get(
        'joinOperator',
      ),
    ).toBeNull()
    expect(
      toApiSearchParams({ ...base, filters, joinOperator: 'or' }).get(
        'joinOperator',
      ),
    ).toBe('or')
  })
})

describe('toColumnFilters', () => {
  it('reads values back off the URL untouched', () => {
    // An earlier version split on punctuation, turning one search into two.
    expect(toColumnFilters({ name: 'John Smith' })).toEqual([
      { id: 'name', value: 'John Smith' },
    ])
    expect(toColumnFilters({ status: ['paid', 'unpaid'] })).toEqual([
      { id: 'status', value: ['paid', 'unpaid'] },
    ])
  })

  it('skips keys the URL does not carry', () => {
    expect(toColumnFilters({ name: null, status: null })).toHaveLength(0)
    expect(toColumnFilters({ name: '' })).toHaveLength(0)
  })
})

describe('buildFilterParsers', () => {
  it('covers every filterable column and nothing else', () => {
    const parsers = buildFilterParsers(columns)

    expect(Object.keys(parsers).sort()).toEqual([
      'active',
      'invoiceDate',
      'itemCount',
      'name',
      'status',
      'totalPrice',
    ])
  })

  it('parses an option-backed column as a list and the rest as single values', () => {
    const parsers = buildFilterParsers(columns)

    expect(parsers.status.parse('paid,unpaid')).toEqual(['paid', 'unpaid'])
    expect(parsers.name.parse('John Smith')).toBe('John Smith')
  })
})
