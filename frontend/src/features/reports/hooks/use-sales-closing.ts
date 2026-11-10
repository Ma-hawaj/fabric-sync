import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { isReportDate } from '../lib/sales-closing'
import type {
  ClosingCheck,
  ClosingCounts,
  SalesClosing,
  BranchDayStatus,
} from '../types/sales-closing'

export function useSalesClosing(date: string, branchId: string) {
  return useQuery({
    queryKey: ['sales-closing', date, branchId],
    queryFn: async () => {
      const { data } = await apiClient.get<SalesClosing>('/sales-closing', {
        params: date ? { date, branchId } : { branchId },
      })
      return data
    },
    enabled: Boolean(branchId) && (!date || isReportDate(date)),
    staleTime: date ? 1000 * 60 * 5 : 0,
  })
}

export function useBranchDayStatus(branchId: string) {
  return useQuery({
    queryKey: ['branch-day-status', branchId],
    queryFn: async () => {
      const { data } = await apiClient.get<BranchDayStatus>(
        '/sales-closing/status',
        { params: { branchId } },
      )
      return data
    },
    enabled: Boolean(branchId),
    staleTime: 0,
    refetchInterval: 30_000,
  })
}

/** Opening/expense writes change the recorded figures and require a fresh check. */
export function useTillAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      path,
      body,
    }: {
      path: string
      body: Record<string, unknown>
    }) => {
      await apiClient.post(path, body)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['sales-closing'] })
      await client.invalidateQueries({ queryKey: ['branch-day-status'] })
    },
  })
}

export function useCloseDay(date: string, branchId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      requestId: string
      branchId: string
      date: string
      checkId: string
      fingerprint: string
    }) => {
      const { data } = await apiClient.post<SalesClosing>(
        '/sales-closing/close',
        input,
      )
      return data
    },
    onSuccess: async (report) => {
      client.setQueryData(['sales-closing', date, branchId], report)
      await client.invalidateQueries({ queryKey: ['sales-closing'] })
      await client.invalidateQueries({ queryKey: ['branch-day-status'] })
    },
  })
}

export function useSaveClosing(date: string, branchId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      requestId: string
      branchId: string
      date: string
      fingerprint: string
      counts: ClosingCounts
    }) => {
      const { data } = await apiClient.post<ClosingCheck>(
        '/sales-closing/checks',
        input,
      )
      return data
    },
    onSuccess: (check) =>
      client.setQueryData<SalesClosing>(
        ['sales-closing', date, branchId],
        (report) => (report ? { ...report, lastCheck: check } : report),
      ),
  })
}
