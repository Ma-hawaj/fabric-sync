import { renderHook } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'

import { useListParams } from './use-list-params'

const columns: ColumnDef<{ name: string }>[] = [
  {
    id: 'name',
    enableColumnFilter: true,
    meta: { label: 'Name', variant: 'text' },
  },
]

describe('useListParams', () => {
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
