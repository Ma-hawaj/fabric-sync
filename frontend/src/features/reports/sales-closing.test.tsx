import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { apiClient } from '@/lib/api'
import { STAFF_USER } from '@/features/users/test-fixtures'
import { SalesClosingPage } from './sales-closing'
import { closingFixture } from './test-fixtures'
import { compareCounts } from './lib/closing-counts'
import type {
  BranchDayStatus,
  ClosingCounts,
  SalesClosing,
} from './types/sales-closing'

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
const branch = closingFixture().branchId
const secondBranch = '00000000-0000-4000-8000-000000000002'
const manager = { ...STAFF_USER, id: 'manager', name: 'Omar Ali' }

function setup(
  searchParams = '',
  dailyOverrides: Partial<BranchDayStatus> = {},
) {
  const reportGet = vi.mocked(apiClient.get).getMockImplementation()!
  vi.mocked(apiClient.get).mockImplementation(async (url, options) => {
    if (url === '/sales-closing/status')
      return {
        data: {
          branchId: branch,
          date: '2026-11-02',
          trackingStartDate: '2026-11-02',
          dailyCheckRequired: true,
          openingRecorded: true,
          closed: false,
          previousUnclosedDate: null,
          canTrade: true,
          canCreateOrders: true,
          ...dailyOverrides,
        },
      }
    return reportGet(url, options)
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['users'], [STAFF_USER, manager])
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
    closedBy: STAFF_USER.id,
    counts,
    comparison: compareCounts(report, counts),
  }
  report.readOnly = true
  return { data: structuredClone(report) }
}

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset()
  vi.mocked(apiClient.post).mockReset()
  vi.mocked(apiClient.patch).mockReset()
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
  it('identifies an expense recorder separately from the manager who voided it', async () => {
    const report = closingFixture()
    report.expenses = [
      {
        id: 'expense-voided',
        amount: 5,
        paymentType: 'cash',
        reason: 'Delivery fee',
        paidTo: 'Courier',
        reference: 'D100',
        recordedAt: '2026-11-02T09:00:00Z',
        recordedBy: STAFF_USER.id,
        voidedAt: '2026-11-02T10:00:00Z',
        voidReason: 'Duplicate receipt',
        voidedBy: manager.id,
      },
    ]
    vi.mocked(apiClient.get).mockResolvedValue({ data: report })
    const client = setup(`?branchId=${branch}`)
    const row = (await screen.findByText('Delivery fee')).closest('tr')!
    expect(within(row).getByText(STAFF_USER.name)).toBeTruthy()
    expect(within(row).getByText(manager.name)).toBeTruthy()
    expect(within(row).getByText('Voided: Duplicate receipt')).toBeTruthy()
    expect(within(row).queryByText(STAFF_USER.id)).toBeNull()
    expect(within(row).queryByText(manager.id)).toBeNull()
    client.clear()
  })

  it('closes a previous day once with a reason while its opening and expenses remain read-only', async () => {
    const report = closingFixture()
    report.readOnly = true
    report.businessDate = '2026-11-03'
    report.previousUnclosedDate = report.date
    report.lateClosingDate = report.date
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: structuredClone(report),
    }))
    vi.mocked(apiClient.post).mockImplementation(async (_path, body) => {
      finalize(report, (body as { counts: ClosingCounts }).counts)
      report.closure!.late = true
      report.closure!.closedAt = '2026-11-03T05:00:00Z'
      report.lateClosingDate = null
      report.previousUnclosedDate = null
      return { data: structuredClone(report) }
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    const close = await screen.findByRole('button', {
      name: 'Review and close previous day',
    })
    expect(screen.queryByText('Correct opening cash (manager)')).toBeNull()
    expect(screen.queryByText('Add paid expense')).toBeNull()
    expect(screen.queryByLabelText('Opening cash counted (BHD)')).toBeNull()
    enterCounts()
    fireEvent.click(close)
    await screen.findByText(/Explain why this day is being closed late/)
    expect(apiClient.post).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Closing notes'), {
      target: {
        value: 'Missed the evening close; counted before opening today.',
      },
    })
    fireEvent.click(close)
    await screen.findByText('Closed late · Read-only')
    expect(apiClient.post).toHaveBeenCalledWith(
      '/sales-closing/close',
      expect.objectContaining({
        branchId: branch,
        date: '2026-11-02',
        counts: expect.objectContaining({
          notes: 'Missed the evening close; counted before opening today.',
        }),
      }),
    )
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Review and close previous day' }),
    ).toBeNull()
    client.clear()
  })

  it('blocks the next opening and links to the previous opened day even without sales', async () => {
    const report = closingFixture('2026-11-03')
    report.opening = null
    report.activity = []
    report.previousUnclosedDate = '2026-11-02'
    report.lateClosingDate = '2026-11-02'
    vi.mocked(apiClient.get).mockResolvedValue({ data: report })
    const client = setup(`?branchId=${branch}&date=2026-11-03`)
    const save = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Save opening cash',
    })
    expect(save.matches(':disabled')).toBe(true)
    expect(
      screen.getByText(
        /A saved opening requires closing even when there were no sales/,
      ),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Close previous day' })
        .getAttribute('href'),
    ).toBe(`/sales-closing?branchId=${branch}&date=2026-11-02`)
    expect(apiClient.post).not.toHaveBeenCalled()
    client.clear()
  })
  it('lets a manager disable the daily trading check while a historical report stays locked', async () => {
    let report = closingFixture()
    report.readOnly = true
    report.businessDate = '2026-11-03'
    vi.mocked(apiClient.get).mockImplementation(async () => ({ data: report }))
    vi.mocked(apiClient.patch).mockImplementation(async (_path, body) => {
      report = {
        ...report,
        missedClosing: {
          id: 'automatic-skip',
          reason:
            'Automatically skipped because the daily trading check was disabled.',
          resolvedAt: '2026-11-03T06:00:00Z',
          resolvedBy: 'manager',
        },
      }
      return {
        data: {
          branchId: branch,
          date: '2026-11-03',
          trackingStartDate: '2026-11-02',
          dailyCheckRequired: (body as { required: boolean }).required,
          openingRecorded: false,
          closed: false,
          previousUnclosedDate: null,
          canTrade: true,
          canCreateOrders: true,
        },
      }
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByText(/Branch controls · Daily trading check required/)
    fireEvent.click(
      screen.getByText(/Branch controls · Daily trading check required/),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Disable daily trading check' }),
    )
    await screen.findByText(/Daily trading check is off for this branch/)
    await screen.findByText(
      /Automatically skipped because the daily trading check was disabled\./,
    )
    expect(apiClient.patch).toHaveBeenCalledWith('/sales-closing/settings', {
      branchId: branch,
      required: false,
    })
    expect(screen.queryByLabelText('Cash physically counted (BHD)')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Review and close day' }),
    ).toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Export CSV' })
        .disabled,
    ).toBe(false)
    client.clear()
  })

  it('starts tracking with the first opening and requires no go-live setup', async () => {
    const report = closingFixture()
    report.trackingStartDate = null
    report.opening = null
    report.activity = []
    report.summary = {
      ...report.summary,
      invoicePayments: 0,
      repairPayments: 0,
      externalRefunds: 0,
      netExternalReceipts: 0,
    }
    report.tenders = []
    vi.mocked(apiClient.get).mockImplementation(async () => ({
      data: structuredClone(report),
    }))
    vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
      expect(path).toBe('/sales-closing/openings')
      const input = body as { amount: number; date: string }
      report.opening = {
        id: 'first-opening',
        amount: input.amount,
        recordedAt: '2026-11-02T05:00:00Z',
        recordedBy: 'staff',
        notes: '',
        supersedesId: null,
      }
      report.trackingStartDate = input.date
      report.fingerprint = 'started-tracking'
      return { data: report.opening }
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    const amount = await screen.findByLabelText('Opening cash counted (BHD)')
    expect(screen.getByText(/Your first opening starts tracking/)).toBeTruthy()
    expect(screen.queryByLabelText('Go-live date')).toBeNull()
    expect(screen.queryByText(/Manager actions/)).toBeNull()
    fireEvent.change(amount, { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save opening cash' }))
    await screen.findByLabelText('Cash physically counted (BHD)')
    expect(screen.queryByText(/Your first opening starts tracking/)).toBeNull()
    expect(apiClient.post).toHaveBeenCalledWith(
      '/sales-closing/openings',
      expect.objectContaining({
        branchId: branch,
        date: '2026-11-02',
        amount: 20,
      }),
    )
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
        resolvedBy: STAFF_USER.id,
      }
      report.previousUnclosedDate = null
      return { data: { ...report } }
    })
    const client = setup(`?branchId=${branch}&date=2026-11-02`)
    await screen.findByText(/Manager actions/)
    fireEvent.click(screen.getByText(/Manager actions/))
    const reason = await screen.findByLabelText('Reason for skipping this day')
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
    fireEvent.click(screen.getByRole('button', { name: 'Skip missed day' }))
    await screen.findByText('Skipped · Unreconciled · Read-only')
    expect(
      within(screen.getByRole('status')).getByText(STAFF_USER.name),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip missed day' })).toBeNull()
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
      within(screen.getByRole('status')).getByText(STAFF_USER.name),
    ).toBeTruthy()
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
    expect(screen.getByRole('button', { name: 'Skip missed day' })).toBeTruthy()
    client.clear()
  })

  it('requires a branch and keeps dates and branch caches separate', async () => {
    const client = setup()
    expect(screen.getByText('Choose the branch you are closing.')).toBeTruthy()
    expect(apiClient.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('combobox', { name: 'Branch' }))
    const mainOption = await screen.findByRole('option', {
      name: 'Main Branch',
    })
    fireEvent.pointerDown(mainOption, { pointerType: 'mouse' })
    fireEvent.click(mainOption)
    await screen.findByText('Main Branch · 2026-11-02')
    expect(apiClient.get).toHaveBeenCalledWith('/sales-closing', {
      params: { branchId: branch },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Report date' }))
    fireEvent.click(
      await screen.findByRole('button', { name: /previous month/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: /October 31.*2026/ }))
    await screen.findByText('Main Branch · 2026-10-31')
    expect(screen.getByText('No activity for this day.')).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox', { name: 'Branch' }))
    const inactiveOption = await screen.findByRole('option', {
      name: 'Second Branch (inactive)',
    })
    fireEvent.pointerDown(inactiveOption, { pointerType: 'mouse' })
    fireEvent.click(inactiveOption)
    await screen.findByText('Second Branch · 2026-10-31')
    expect(apiClient.get).toHaveBeenCalledWith('/sales-closing', {
      params: { branchId: secondBranch, date: '2026-10-31' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear Report date' }))
    await screen.findByText('Second Branch · 2026-11-02')
    expect(apiClient.get).toHaveBeenCalledWith('/sales-closing', {
      params: { branchId: secondBranch },
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
    const opening = screen
      .getByRole('heading', { name: '1. Opening cash' })
      .closest('section')!
    expect(within(opening).getByText(STAFF_USER.name)).toBeTruthy()
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
    const expense = screen.getByText('Delivery fee').closest('tr')!
    expect(within(expense).getByText(STAFF_USER.name)).toBeTruthy()
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
