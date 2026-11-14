import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { PICKER_PER_PAGE } from '@/lib/async-combobox'
import { listResponse } from '@/lib/list-fixtures'
import { ISSUING_BRANCH_FILTERS } from '@/features/locations/lib/location-filters'
import { STAFF_USER } from '@/features/users/test-fixtures'
import type { FinancialBranch } from '../types/invoice-detail'
import { FinancialBranchPanel } from './financial-branch-panel'

const auth = useAuth()
const branchId = '00000000-0000-4000-8000-000000000001'
const empty: FinancialBranch = {
  branchId: null,
  branchName: null,
  assignedAt: null,
  assignedBy: null,
  reason: null,
}

beforeEach(() =>
  vi
    .mocked(useAuth)
    .mockReturnValue({ ...auth, user: { ...auth.user!, roles: ['manager'] } }),
)
afterEach(() => vi.restoreAllMocks())

function setup(branch = empty) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['users'], [STAFF_USER])
  client.setQueryData(
    [
      'invoice-issuing-branch',
      'name',
      JSON.stringify(ISSUING_BRANCH_FILTERS),
      '',
      PICKER_PER_PAGE,
    ],
    {
      pages: [
        listResponse([{ id: branchId, name: 'Main Branch', isActive: true }]),
      ],
      pageParams: [1],
    },
  )
  render(
    <QueryClientProvider client={client}>
      <FinancialBranchPanel invoiceId="invoice-1" branch={branch} />
    </QueryClientProvider>,
  )
  return client
}

describe('financial branch recovery', () => {
  it('requires a reason and retains the request identity across an uncertain retry', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValue({ data: {} })
    const client = setup()
    fireEvent.click(
      screen.getByRole('button', { name: 'Assign financial branch' }),
    )
    await screen.findByText('Choose a financial branch.')
    expect(post).not.toHaveBeenCalled()
    const picker = screen.getByRole<HTMLInputElement>('combobox', {
      name: 'Financial branch',
    })
    fireEvent.focus(picker)
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    const option = await screen.findByRole('option', { name: 'Main Branch' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)
    fireEvent.change(
      screen.getByLabelText('Reason for assigning this branch'),
      { target: { value: 'Imported invoice needs settlement.' } },
    )
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Assign financial branch',
    })
    fireEvent.click(submit)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(submit.matches(':disabled')).toBe(false))
    fireEvent.click(submit)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1])
    expect(post).toHaveBeenCalledWith(
      '/invoices/invoice-1/financial-branch',
      expect.objectContaining({
        branchId,
        reason: 'Imported invoice needs settlement.',
      }),
    )
    client.clear()
  })

  it('shows sales staff the recovery requirement without granting the assignment form', () => {
    vi.mocked(useAuth).mockReturnValue({
      ...auth,
      user: { ...auth.user!, roles: ['sales'] },
    })
    const client = setup()
    expect(screen.getByText(/A manager must assign one/)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Assign financial branch' }),
    ).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    client.clear()
  })

  it('displays the saved actor and reason with no reassignment action', () => {
    const client = setup({
      branchId,
      branchName: 'Main Branch',
      assignedAt: '2026-11-14T10:00:00Z',
      assignedBy: STAFF_USER.id,
      reason: 'Imported invoice.',
    })
    expect(screen.getByText(STAFF_USER.name)).toBeTruthy()
    expect(screen.getByText('Imported invoice.')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Assign financial branch' }),
    ).toBeNull()
    client.clear()
  })
})
