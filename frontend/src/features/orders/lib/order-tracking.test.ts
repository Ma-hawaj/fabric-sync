import { describe, expect, it } from 'vitest'
import {
  COMPLETED,
  NOT_STARTED,
  currentStageLabel,
  openRepairCount,
  repairStatusLabel,
  stageFilterOptions,
  stageStatusLabel,
  stageTimingLabel,
} from './order-tracking'
import type {
  Order,
  OrderRepair,
  OrderStageEntry,
  OrderStageStatus,
} from '../types/orders'

function stage(
  name: string,
  sortOrder: number,
  status: OrderStageStatus,
  overrides: Partial<OrderStageEntry> = {},
): OrderStageEntry {
  return {
    stageId: `stage-${sortOrder}`,
    name,
    sortOrder,
    requiresDelivery: false,
    applicable: true,
    status,
    startedAt: null,
    completedAt: null,
    locationId: null,
    location: null,
    notes: null,
    ...overrides,
  }
}

function order(overrides: Partial<Order>): Order {
  return {
    id: 'order-1',
    invoiceId: 'invoice-1',
    invoiceDate: new Date('2026-07-01'),
    measurementId: 'measurement-1',
    customerName: 'Abdullah Al-Otaibi',
    customerMobile: '0501234567',
    material: 'Japanese Cotton',
    materialAmount: 3.5,
    price: 450,
    status: 'pending',
    productionLocationId: 'workshop',
    productionLocation: 'Central Workshop',
    productionLocationInferred: false,
    receivingLocationId: 'branch',
    receivingLocation: 'Riyadh Main Branch',
    stages: [],
    currentStage: null,
    repairs: [],
    invoiceTotalPrice: 954.5,
    invoiceAmountPaid: 0,
    invoicePaymentStatus: 'unpaid',
    invoiceAdvanceAmount: 0,
    invoiceAdvancePaymentType: null,
    invoiceFinalPaymentType: null,
    ...overrides,
  }
}

function repair(overrides: Partial<OrderRepair>): OrderRepair {
  return {
    id: 'repair-1',
    reason: 'Sleeve too long',
    reportedOn: '2026-07-20',
    charge: 0,
    status: 'open',
    completedAt: null,
    notes: null,
    ...overrides,
  }
}

const FULL_CHECKLIST = [
  stage('Cutting', 1, 'pending'),
  stage('Sewing', 2, 'pending'),
  stage('Finishing', 3, 'pending'),
  stage('Location delivery', 4, 'pending', { requiresDelivery: true }),
]

describe('currentStageLabel', () => {
  it('reads as not started when nothing has been recorded', () => {
    expect(
      currentStageLabel(
        order({ stages: FULL_CHECKLIST, currentStage: 'Cutting' }),
      ),
    ).toBe(NOT_STARTED)
  })

  it('names the outstanding stage once work has begun', () => {
    const stages = [
      stage('Cutting', 1, 'done'),
      stage('Sewing', 2, 'pending'),
      stage('Finishing', 3, 'pending'),
    ]
    expect(currentStageLabel(order({ stages, currentStage: 'Sewing' }))).toBe(
      'Sewing',
    )
  })

  it('reads as completed once nothing applicable is outstanding', () => {
    const stages = [stage('Cutting', 1, 'done'), stage('Sewing', 2, 'done')]
    expect(currentStageLabel(order({ stages, currentStage: null }))).toBe(
      COMPLETED,
    )
  })

  it('reads as completed when only a non-applicable delivery is left', () => {
    // Produced at the branch the customer collects from, so the delivery stage
    // never applied and the order is finished after Finishing.
    const stages = [
      stage('Cutting', 1, 'done'),
      stage('Sewing', 2, 'done'),
      stage('Finishing', 3, 'done'),
      stage('Location delivery', 4, 'pending', {
        requiresDelivery: true,
        applicable: false,
      }),
    ]
    expect(currentStageLabel(order({ stages, currentStage: null }))).toBe(
      COMPLETED,
    )
  })
})

describe('stageFilterOptions', () => {
  it('lists every stage in checklist order, bracketed by the two derived labels', () => {
    const options = stageFilterOptions([
      order({ stages: FULL_CHECKLIST }),
      order({ id: 'order-2', stages: [stage('Cutting', 1, 'done')] }),
    ])
    expect(options).toEqual([
      NOT_STARTED,
      'Cutting',
      'Sewing',
      'Finishing',
      'Location delivery',
      COMPLETED,
    ])
  })
})

describe('stageStatusLabel', () => {
  it('calls out a stage that does not apply ahead of its status', () => {
    expect(
      stageStatusLabel(
        stage('Location delivery', 4, 'pending', {
          requiresDelivery: true,
          applicable: false,
        }),
      ),
    ).toBe('Not needed')
  })

  it('labels the recorded states', () => {
    expect(stageStatusLabel(stage('Cutting', 1, 'done'))).toBe('Done')
    expect(stageStatusLabel(stage('Cutting', 1, 'skipped'))).toBe('Skipped')
    expect(stageStatusLabel(stage('Cutting', 1, 'pending'))).toBe('Pending')
  })
})

describe('stageTimingLabel', () => {
  it('is null for a stage nothing has reached yet', () => {
    expect(stageTimingLabel(stage('Finishing', 3, 'pending'))).toBeNull()
  })

  it('shows a waiting-since time for the current stage', () => {
    const label = stageTimingLabel(
      stage('Sewing', 2, 'pending', { startedAt: '2026-07-20T10:00:00Z' }),
    )
    expect(label).toMatch(/^Waiting since/)
  })

  it('shows a start-to-finish range for a recorded stage', () => {
    const label = stageTimingLabel(
      stage('Cutting', 1, 'done', {
        startedAt: '2026-07-20T10:00:00Z',
        completedAt: '2026-07-20T12:30:00Z',
      }),
    )
    expect(label).toMatch(/→/)
    expect(label).not.toMatch(/waiting/i)
  })
})

describe('openRepairCount', () => {
  it('counts only repairs that still need work', () => {
    const repairs = [
      repair({ id: 'a', status: 'open' }),
      repair({ id: 'b', status: 'in_progress' }),
      repair({ id: 'c', status: 'completed' }),
      repair({ id: 'd', status: 'cancelled' }),
    ]
    expect(openRepairCount(order({ repairs }))).toBe(2)
  })

  it('is zero for an order that never came back', () => {
    expect(openRepairCount(order({}))).toBe(0)
  })
})

describe('repairStatusLabel', () => {
  it('renders the stored snake_case status readably', () => {
    expect(repairStatusLabel('in_progress')).toBe('In progress')
    expect(repairStatusLabel('open')).toBe('Open')
  })
})
