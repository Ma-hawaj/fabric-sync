import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { createEmptyInvoiceForm } from '../types/invoice-form'
import { useCreateInvoice } from './use-create-invoice'
import { useUpdateInvoice } from './use-update-invoice'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const values = () => ({ ...createEmptyInvoiceForm(), expectedVatRate: 0.1 })

afterEach(() => vi.restoreAllMocks())

describe('invoice mutation caches', () => {
  it('drops the customer picker cache after creating an invoice', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} })
    const client = new QueryClient()
    const remove = vi.spyOn(client, 'removeQueries').mockResolvedValue()
    const { result } = renderHook(useCreateInvoice, {
      wrapper: wrapper(client),
    })
    await act(async () => {
      await result.current.mutateAsync(values())
    })
    expect(remove).toHaveBeenCalledWith({ queryKey: ['invoice-customer'] })
  })

  it('drops the customer picker cache after updating an invoice', async () => {
    vi.spyOn(apiClient, 'put').mockResolvedValue({ data: {} })
    const client = new QueryClient()
    const remove = vi.spyOn(client, 'removeQueries').mockResolvedValue()
    const { result } = renderHook(() => useUpdateInvoice('invoice-1'), {
      wrapper: wrapper(client),
    })
    await act(async () => {
      await result.current.mutateAsync(values())
    })
    expect(remove).toHaveBeenCalledWith({ queryKey: ['invoice-customer'] })
  })
})
