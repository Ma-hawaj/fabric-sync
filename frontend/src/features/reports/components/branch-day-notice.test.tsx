import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BranchDayStatus } from '../types/sales-closing'
import { BranchDayNotice } from './branch-day-notice'

describe('blocked invoice edit notices', () => {
  it.each([
    { closed: true },
    { previousUnclosedDate: '2026-11-01' },
    { previousUnclosedDate: '2026-11-01', lateClosingDate: '2026-11-01' },
    {},
  ])(
    'describes editing when branch requirements block saving: %j',
    (overrides) => {
      const status: BranchDayStatus = {
        branchId: 'branch',
        date: '2026-11-02',
        dailyCheckRequired: true,
        trackingStartDate: '2026-11-01',
        openingRecorded: false,
        closed: false,
        previousUnclosedDate: null,
        canTrade: false,
        canCreateOrders: false,
        ...overrides,
      }
      render(
        <BranchDayNotice
          status={status}
          branchId="branch"
          loading={false}
          failed={false}
          editing
        />,
      )
      expect(screen.getByRole('alert').textContent).toContain(
        'this invoice edit',
      )
      expect(screen.getByRole('alert').textContent).not.toMatch(/new orders/i)
    },
  )
})
