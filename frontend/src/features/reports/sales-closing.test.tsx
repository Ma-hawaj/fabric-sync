import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { apiClient } from '@/lib/api'
import { SalesClosingPage } from './sales-closing'
import { closingFixture } from './test-fixtures'
import { compareCounts } from './lib/closing-counts'
import type { ClosingCounts, SalesClosing } from './types/sales-closing'

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
const branch = closingFixture().branchId
const secondBranch = '00000000-0000-4000-8000-000000000002'

function setup(searchParams = '') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['locations', ''], {
    data: [
      {
        id: branch,
        name: 'Main Branch',
        receivesOrders: true,
        holdsStock: true,
        isActive: true,
      },
      {
        id: secondBranch,
        name: 'Second Branch',
        receivesOrders: true,
        holdsStock: false,
        isActive: false,
      },
    ],
    page: 1,
    perPage: 2,
    total: 2,
    pageCount: 1,
  })
  client.setQueryData(['default-location'], {
    defaultLocationId: null,
    defaultLocation: null,
  })
  render(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <SalesClosingPage />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  return client
}

function enterCounts(cash = '72') {
  for (const [label, value] of [
    ['Other cash added (BHD)', '0'],
    ['Cash banked / transferred out (BHD)', '0'],
    ['Cash physically counted (BHD)', cash],
    ['Confirmed net Benefit (BHD)', '0'],
    ['Confirmed net Card (BHD)', '0'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I verified the listed payments/ }),
  )
}

function finalize(report: SalesClosing, counts: ClosingCounts) {
  report.closure = {
    id: 'closure-1',
    closedAt: '2026-11-02T18:30:00Z',
    closedBy: 'test-closer',
    counts,
    comparison: compareCounts(report, counts),
  }
  report.readOnly = true
  return { data: structuredClone(report) }
}

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset()
  vi.mocked(apiClient.post).mockReset()
  vi.mocked(apiClient.get).mockImplementation(async (_url, options) => {
    const params = options?.params as { date?: string; branchId: string }
    const report = closingFixture(params.date)
    report.branchId = params.branchId
    if (params.branchId === secondBranch) report.branchName = 'Second Branch'
    if (params.date === '2026-10-31') report.activity = []
    return { data: report }
  })
})

describe('branch closing workflow', () => {
  it('sets a fixed go-live date without adding counts to earlier history', async () => {
    const report = closingFixture()
    report.policy = null
    report.readOnly = true
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: { ...report },
    }))
    vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
      expect(path).toBe('/sales-closing/setup')
      const input = body as { startsOn: string }
      report.policy = {
        startsOn: input.startsOn,
        configuredAt: '2026-11-02T10:00:00Z',
        configuredBy: 'manager',
      }
      return { data: report.policy }
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByText(/Manager actions/)
    fireEvent.click(screen.getByText(/Manager actions/))
    const date = await screen.findByLabelText<HTMLInputElement>('Go-live date')
    expect(date.value).toBe('2026-11-03')
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Set go-live date' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Set go-live date' }),
      ).toBeNull(),
    )
    expect(apiClient.post).toHaveBeenCalledWith(
      '/sales-closing/setup',
      expect.objectContaining({ branchId: branch, startsOn: '2026-11-03' }),
    )
    expect(
      screen.queryByRole('button', { name: 'Review and close day' }),
    ).toBeNull()
    client.clear()
  })

  it('resolves a missed close separately and keeps every past count field locked', async () => {
    const report = closingFixture()
    report.businessDate = '2026-11-03'
    report.readOnly = true
    report.previousUnclosedDate = report.date
    const fingerprint = report.fingerprint
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: { ...report },
    }))
    vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
      expect(path).toBe('/sales-closing/missed')
      const input = body as { reason: string }
      report.missedClosing = {
        id: 'missed-1',
        reason: input.reason,
        resolvedAt: '2026-11-03T06:00:00Z',
        resolvedBy: 'manager',
      }
      report.previousUnclosedDate = null
      return { data: { ...report } }
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByText(/Manager actions/)
    fireEvent.click(screen.getByText(/Manager actions/))
    const reason = await screen.findByLabelText(
      'Manager explanation for the missed closing',
    )
    fireEvent.change(reason, {
      target: {
        value:
          'Staff missed the cash count. No historical balance is being supplied.',
      },
    })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand that this does not reconcile/,
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Resolve missed closing' }),
    )
    await screen.findByText(
      'Missed closing resolved · Unreconciled · Read-only',
    )
    expect(
      screen.queryByRole('button', { name: 'Resolve missed closing' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Review and close day' }),
    ).toBeNull()
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    expect(report.fingerprint).toBe(fingerprint)
    const body = vi.mocked(apiClient.post).mock.calls[0][1] as Record<
      string,
      unknown
    >
    expect(Object.keys(body).sort()).toEqual([
      'branchId',
      'date',
      'reason',
      'requestId',
    ])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Export CSV' })
        .disabled,
    ).toBe(false)
    client.clear()
  })

  it('finalizes an explained difference and displays a read-only saved report', async () => {
    const report = closingFixture()
    report.businessDate = report.date
    const counts: ClosingCounts = {
      branchActivityConfirmed: true,
      openingCash: 20,
      cashAdded: 0,
      cashRemoved: 0,
      actualCash: 70,
      actualBenefit: 0,
      actualCard: 0,
      notes: 'Recounted: BHD 2 short; manager informed.',
    }
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: structuredClone(report),
    }))
    vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
      expect(path).toBe('/sales-closing/close')
      return finalize(report, (body as { counts: ClosingCounts }).counts)
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByLabelText('Cash physically counted (BHD)')
    enterCounts('70')
    fireEvent.change(screen.getByLabelText('Closing notes'), {
      target: { value: counts.notes },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review and close day' }),
    )
    await screen.findByText('Closed · Read-only')
    expect(
      screen.queryByRole('button', { name: 'Review and close day' }),
    ).toBeNull()
    expect(screen.queryByText('Add paid expense')).toBeNull()
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    expect(screen.getByText(counts.notes)).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Export CSV' })
        .disabled,
    ).toBe(false)
    expect(apiClient.post).toHaveBeenCalledWith(
      '/sales-closing/close',
      expect.objectContaining({
        branchId: branch,
        date: report.date,
        counts,
        fingerprint: report.fingerprint,
      }),
    )
    client.clear()
  })

  it('locks every older report and offers a separate missed-closing resolution', async () => {
    const report = closingFixture()
    report.businessDate = '2026-11-09'
    report.readOnly = true
    report.previousUnclosedDate = '2026-11-01'
    vi.mocked(apiClient.get).mockResolvedValue({ data: report })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByText('Main Branch · 2026-11-02')
    fireEvent.click(screen.getByText(/Manager actions/))
    expect(
      screen
        .getByRole('link', { name: 'View the missed day' })
        .getAttribute('href'),
    ).toContain('date=2026-11-01')
    expect(screen.queryByText('Add paid expense')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Close branch day' }),
    ).toBeNull()
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Review and close day' }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Resolve missed closing' }),
    ).toBeTruthy()
    client.clear()
  })

  it('requires a branch and keeps dates and branch caches separate', async () => {
    const client = setup()
    expect(screen.getByText('Choose the branch you are closing.')).toBeTruthy()
    expect(apiClient.get).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Branch'), {
      target: { value: branch },
    })
    await screen.findByText('Main Branch · 2026-11-02')
    expect(apiClient.get).toHaveBeenCalledWith('/sales-closing', {
      params: { branchId: branch },
    })
    fireEvent.change(screen.getByLabelText('Report date'), {
      target: { value: '2026-10-31' },
    })
    await screen.findByText('Main Branch · 2026-10-31')
    expect(screen.getByText('No activity for this day.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Branch'), {
      target: { value: secondBranch },
    })
    await screen.findByText('Second Branch · 2026-10-31')
    expect(apiClient.get).toHaveBeenLastCalledWith('/sales-closing', {
      params: { branchId: secondBranch, date: '2026-10-31' },
    })
    client.clear()
  })
  it('preserves unsaved counts and notes after activity changes and requires a new review', async () => {
    const report = closingFixture()
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: structuredClone(report),
    }))
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByLabelText('Cash physically counted (BHD)')
    enterCounts('71')
    fireEvent.change(screen.getByLabelText('Closing notes'), {
      target: { value: 'Recount in progress.' },
    })
    report.fingerprint = 'new-payment'
    report.tenders[0].net += 5
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: /I verified/ })
          .checked,
      ).toBe(false),
    )
    expect(
      screen.getByLabelText<HTMLInputElement>('Cash physically counted (BHD)')
        .value,
    ).toBe('71')
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Closing notes').value,
    ).toBe('Recount in progress.')
    expect(screen.getAllByText('-6.000').length).toBeGreaterThan(0)
    expect(apiClient.post).not.toHaveBeenCalled()
    client.clear()
  })

  it('recovers an uncertain close through refresh without submitting a second closing', async () => {
    const report = closingFixture()
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: structuredClone(report),
    }))
    vi.mocked(apiClient.post).mockImplementation(async (_path, body) => {
      finalize(report, (body as { counts: ClosingCounts }).counts)
      throw new Error('Response lost after commit')
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByLabelText('Cash physically counted (BHD)')
    enterCounts()
    fireEvent.click(
      screen.getByRole('button', { name: 'Review and close day' }),
    )
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Review and close day',
        }).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Closed · Read-only')
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    expect(apiClient.post).toHaveBeenCalledOnce()
    client.clear()
  })
  it('records opening first and deducts a paid delivery expense from the closing comparison', async () => {
    const report = closingFixture()
    report.opening = null
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: structuredClone(report),
    }))
    vi.mocked(apiClient.post).mockImplementation(async (url, body) => {
      const input = body as Record<string, unknown>
      if (url === '/sales-closing/openings') {
        report.opening = {
          id: 'opening-saved',
          amount: Number(input.amount),
          recordedAt: '2026-11-02T05:00:00Z',
          recordedBy: 'staff',
          notes: '',
          supersedesId: null,
        }
        report.fingerprint = 'opening-saved'
        return { data: report.opening }
      }
      if (url === '/sales-closing/expenses') {
        report.expenses = [
          {
            id: 'expense-saved',
            amount: Number(input.amount),
            paymentType: 'cash',
            reason: String(input.reason),
            paidTo: String(input.paidTo),
            reference: String(input.reference),
            recordedAt: '2026-11-02T09:00:00Z',
            recordedBy: 'staff',
            voidedAt: null,
            voidReason: null,
            voidedBy: null,
          },
        ]
        report.tenders[0].expenses = Number(input.amount)
        report.tenders[0].afterExpenses = 46.995
        report.fingerprint = 'expense-saved'
        return { data: report.expenses[0] }
      }
      return finalize(report, input.counts as ClosingCounts)
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByLabelText('Opening cash counted (BHD)')
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    fireEvent.change(screen.getByLabelText('Opening cash counted (BHD)'), {
      target: { value: '20' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save opening cash' }))
    await screen.findByLabelText('Cash physically counted (BHD)')
    expect(screen.queryByLabelText('Opening cash counted (BHD)')).toBeNull()
    fireEvent.click(screen.getByText('Add paid expense'))
    for (const [label, value] of [
      ['Expense amount (BHD)', '5.005'],
      ['Reason (for example, delivery fee)', 'Delivery fee'],
      ['Paid to (optional)', 'Courier'],
      ['Receipt / reference (optional)', 'D100'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Record paid expense' }))
    await screen.findByText(/Paid from cash drawer: BHD 5.005/)
    expect(apiClient.post).toHaveBeenCalledWith(
      '/sales-closing/expenses',
      expect.objectContaining({
        branchId: branch,
        amount: 5.005,
        reason: 'Delivery fee',
        paymentType: 'cash',
        reference: 'D100',
      }),
    )
    for (const [label, value] of [
      ['Other cash added (BHD)', '0'],
      ['Cash banked / transferred out (BHD)', '0'],
      ['Cash physically counted (BHD)', '66.995'],
      ['Confirmed net Benefit (BHD)', '0'],
      ['Confirmed net Card (BHD)', '0'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(
      screen.getByRole('checkbox', { name: /I verified the listed payments/ }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Review and close day' }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Export CSV' })
          .disabled,
      ).toBe(false),
    )
    expect(screen.getAllByText('66.995').length).toBeGreaterThan(0)
    client.clear()
  })
  it('shows a request failure instead of presenting zero totals', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('unavailable'))
    const client = setup(`?branchId=${branch}&date=2026-11-01`)
    await screen.findByText(/Could not load the closing report/)
    expect(screen.queryByText('No activity for this day.')).toBeNull()
    client.clear()
  })
  it('does not query malformed dates', async () => {
    const client = setup(`?branchId=${branch}&date=2026-02-30`)
    expect(screen.getByRole('alert').textContent).toContain(
      'Choose a valid branch and report date',
    )
    expect(apiClient.get).not.toHaveBeenCalled()
    client.clear()
  })
})
