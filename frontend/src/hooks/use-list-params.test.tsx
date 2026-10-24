import { act, renderHook, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'

import { useListParams } from './use-list-params'
import { useTableFilters } from './use-table-filters'

const columns: ColumnDef<{ name: string }>[] = [
  {
    id: 'name',
    enableColumnFilter: true,
    meta: { label: 'Name', variant: 'text' },
  },
]

describe('useListParams', () => {
  it('forwards advanced operators and ignores draft rules without a value', () => {
    const filters = [
      {
        id: 'name',
        value: 'Ali',
        variant: 'text',
        operator: 'ne',
        filterId: 'one',
      },
      {
        id: 'name',
        value: 'Saleh',
        variant: 'text',
        operator: 'eq',
        filterId: 'two',
      },
      {
        id: 'name',
        value: '',
        variant: 'text',
        operator: 'iLike',
        filterId: 'draft',
      },
    ]
    const wrapper = withNuqsTestingAdapter({
      searchParams: `?joinOperator=or&filters=${encodeURIComponent(JSON.stringify(filters))}`,
    })
    const { result } = renderHook(() => useListParams({ columns }), { wrapper })
    expect(JSON.parse(result.current.searchParams.get('filters')!)).toEqual([
      { id: 'name', value: 'Ali', variant: 'text', operator: 'ne' },
      { id: 'name', value: 'Saleh', variant: 'text', operator: 'eq' },
    ])
    expect(result.current.searchParams.get('joinOperator')).toBe('or')
  })

  it('migrates a bookmarked simple filter and resets pagination when rules change', async () => {
    const wrapper = withNuqsTestingAdapter({
      searchParams: '?page=4&name=Ali',
      hasMemory: true,
    })
    const { result } = renderHook(
      () => ({
        request: useListParams({ columns }),
        editor: useTableFilters(columns),
      }),
      { wrapper },
    )
    expect(result.current.request.page).toBe(4)
    await act(async () => {
      await result.current.editor.setFilters((previous) => [
        ...previous,
        {
          id: 'name',
          value: 'Saleh',
          variant: 'text',
          operator: 'ne',
          filterId: 'two',
        },
      ])
    })
    await waitFor(() => expect(result.current.request.page).toBe(1))
    expect(
      JSON.parse(result.current.request.searchParams.get('filters')!),
    ).toHaveLength(2)
    await act(async () => {
      await result.current.editor.setFilters([])
    })
    await waitFor(() =>
      expect(result.current.request.searchParams.get('filters')).toBeNull(),
    )
  })

  it('forwards a validated URL join operator to the list request', () => {
    const wrapper = withNuqsTestingAdapter({
      searchParams: '?page=3&perPage=5&name=ali&joinOperator=or',
    })

    const { result } = renderHook(() => useListParams({ columns }), { wrapper })

    expect(result.current.searchParams.get('page')).toBe('3')
    expect(result.current.searchParams.get('joinOperator')).toBe('or')
    expect(result.current.searchParams.get('filters')).toContain('ali')
  })

  it('ignores an unrecognized URL join operator', () => {
    const wrapper = withNuqsTestingAdapter({
      searchParams: '?name=ali&joinOperator=invalid',
    })

    const { result } = renderHook(() => useListParams({ columns }), { wrapper })

    expect(result.current.searchParams.get('joinOperator')).toBeNull()
  })
})
