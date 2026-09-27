import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AsyncCombobox } from './async-combobox'
import { apiGetMock } from '@/lib/list-fixtures'

interface LocationRow {
  id: string
  name: string
}

const LOCATIONS: LocationRow[] = [
  { id: 'loc-1', name: 'Main Warehouse' },
  { id: 'loc-2', name: 'Downtown Branch' },
]

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

function Picker({ value }: { value: string | null }) {
  return (
    <AsyncCombobox<LocationRow>
      endpoint="/locations"
      queryKey="repro-receiving-branch"
      searchField="name"
      toOption={(location) => ({
        value: location.id,
        label: location.name,
      })}
      getValueLabel={(id) =>
        id === 'loc-2' ? 'Downtown Branch (default)' : null
      }
      value={value}
      onValueChange={() => {}}
      placeholder="Search branch..."
      emptyMessage="No branches found."
    />
  )
}

function renderPicker(value: string | null) {
  apiGet.mockImplementation(apiGetMock({ '/locations': LOCATIONS }))
  const client = new QueryClient()
  const ui = (next: string | null) => (
    <QueryClientProvider client={client}>
      <Picker value={next} />
    </QueryClientProvider>
  )
  const rendered = render(ui(value))
  return {
    ...rendered,
    rerenderValue: (next: string | null) => rendered.rerender(ui(next)),
  }
}

describe('AsyncCombobox programmatic value', () => {
  it('shows the label when the value arrives after mount (default prefill)', async () => {
    const { rerenderValue } = renderPicker(null)
    const input =
      screen.getByPlaceholderText<HTMLInputElement>('Search branch...')
    expect(input.value).toBe('')
    // The default-location effect stamps the field once preferences load —
    // the row is not on any loaded page, so the label comes from getValueLabel.
    rerenderValue('loc-2')
    await waitFor(() => expect(input.value).toBe('Downtown Branch (default)'))
  })

  it('shows the label for a stored value present at mount (edit form)', async () => {
    renderPicker('loc-2')
    const input =
      screen.getByPlaceholderText<HTMLInputElement>('Search branch...')
    await waitFor(() => expect(input.value).toBe('Downtown Branch (default)'))
  })
})
