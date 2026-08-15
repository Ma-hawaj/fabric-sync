import { describe, expect, it } from 'vitest'
import {
  averageStageDuration,
  collectedByPaymentMethod,
  completedOrderCount,
  deltaPercent,
  financialSummary,
  materialDemandVsStock,
  orderCompletedAt,
  orderValueByBranch,
  repairBreakdown,
  revenueTrend,
  throughput,
  topMaterialsByValue,
  workInProgressByStage,
} from './analytics'
import { buildBuckets, periodRange } from './period'
import type { Invoice } from '@/features/invoices/types/invoices'
import type { Material } from '@/features/inventory/types/inventory'
import type { Order, OrderStageEntry } from '@/features/orders/types/orders'

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    date: '2026-08-01',
    customers: [],
    itemCount: 1,
    materials: ['Cotton'],
    totalPrice: 100,
    paymentStatus: 'paid',
    amountPaid: 100,
    advanceAmount: 0,
    advancePaymentType: null,
    finalPaymentType: 'cash',
    ...overrides,
  }
}

function stage(overrides: Partial<OrderStageEntry> = {}): OrderStageEntry {
  return {
    stageId: 'stage-1',
    name: 'Cutting',
    sortOrder: 1,
    requiresDelivery: false,
    applicable: true,
    status: 'done',
    startedAt: '2026-08-01T00:00:00Z',
    completedAt: '2026-08-01T04:00:00Z',
    locationId: null,
    location: null,
    notes: null,
    assigneeId: null,
    assigneeName: null,
    ...overrides,
  }
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    invoiceId: 'inv-1',
    invoiceDate: new Date('2026-08-01T00:00:00Z'),
    measurementId: 'm-1',
    customerName: 'Ali',
    customerMobile: '3600 0000',
    material: 'Cotton',
    materialAmount: 3,
    price: 40,
    status: 'pending',
    productionLocationId: null,
    productionLocation: null,
    productionLocationInferred: false,
    receivingLocationId: 'loc-1',
    receivingLocation: 'Manama',
    stages: [],
    currentStage: null,
    repairs: [],
    invoiceTotalPrice: 100,
    invoiceAmountPaid: 100,
    invoicePaymentStatus: 'paid',
    invoiceAdvanceAmount: 0,
    invoiceAdvancePaymentType: null,
    invoiceFinalPaymentType: 'cash',
    ...overrides,
  }
}

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: 'mat-1',
    name: 'Cotton',
    sku: null,
    unit: 'meters',
    locations: [{ locationId: 'loc-1', location: 'Manama', quantity: 20 }],
    ...overrides,
  }
}

describe('financialSummary', () => {
  it('sums invoice money and averages order money separately', () => {
    const summary = financialSummary(
      [
        invoice({ totalPrice: 110, amountPaid: 60 }),
        invoice({ id: 'inv-2', totalPrice: 220, amountPaid: 220 }),
      ],
      [order({ price: 40 }), order({ id: 'ord-2', price: 60 })],
    )

    expect(summary.invoiced).toBe(330)
    expect(summary.collected).toBe(280)
    expect(summary.outstanding).toBe(50)
    expect(summary.averageOrderValue).toBe(50)
  })

  it('never reports an overpayment as a debt', () => {
    const summary = financialSummary(
      [invoice({ totalPrice: 100, amountPaid: 120 })],
      [],
    )

    expect(summary.outstanding).toBe(0)
  })

  it('averages nothing to zero rather than NaN', () => {
    expect(financialSummary([], []).averageOrderValue).toBe(0)
  })
})

describe('deltaPercent', () => {
  it('reports the change against the previous window', () => {
    expect(deltaPercent(150, 100)).toBe(50)
    expect(deltaPercent(50, 100)).toBe(-50)
  })

  it('has no answer when the baseline is zero or missing', () => {
    expect(deltaPercent(150, 0)).toBeNull()
    expect(deltaPercent(150, null)).toBeNull()
  })
})

describe('revenueTrend', () => {
  const now = new Date('2026-08-14T12:00:00Z')
  const range = periodRange('12m', now)
  const buckets = buildBuckets(range, null)

  it('keeps empty months in the series', () => {
    const trend = revenueTrend([], buckets, range.bucket)

    expect(trend).toHaveLength(12)
    expect(trend.every((point) => point.invoiced === 0)).toBe(true)
  })

  it('adds invoices into the month they were issued', () => {
    const trend = revenueTrend(
      [
        invoice({ date: '2026-08-03', totalPrice: 100, amountPaid: 40 }),
        invoice({
          id: 'inv-2',
          date: '2026-08-28',
          totalPrice: 50,
          amountPaid: 50,
        }),
        invoice({
          id: 'inv-3',
          date: '2026-07-15',
          totalPrice: 70,
          amountPaid: 0,
        }),
      ],
      buckets,
      range.bucket,
    )

    const august = trend[trend.length - 1]
    const july = trend[trend.length - 2]

    expect(august.invoiced).toBe(150)
    expect(august.collected).toBe(90)
    expect(july.invoiced).toBe(70)
  })

  it('ignores an invoice outside the buckets', () => {
    const trend = revenueTrend(
      [invoice({ date: '2019-01-01', totalPrice: 999 })],
      buckets,
      range.bucket,
    )

    expect(trend.every((point) => point.invoiced === 0)).toBe(true)
  })
})

describe('collectedByPaymentMethod', () => {
  it('splits an invoice between its advance and its final payment', () => {
    const methods = collectedByPaymentMethod([
      invoice({
        totalPrice: 100,
        amountPaid: 100,
        advanceAmount: 30,
        advancePaymentType: 'benefit',
        finalPaymentType: 'card',
      }),
    ])

    expect(methods.find((entry) => entry.method === 'Benefit')?.amount).toBe(30)
    expect(methods.find((entry) => entry.method === 'Card')?.amount).toBe(70)
    expect(methods.find((entry) => entry.method === 'Cash')?.amount).toBe(0)
  })

  it('counts only what was actually paid, not what was promised', () => {
    const methods = collectedByPaymentMethod([
      invoice({
        totalPrice: 100,
        amountPaid: 20,
        advanceAmount: 30,
        advancePaymentType: 'cash',
        finalPaymentType: 'card',
      }),
    ])

    expect(methods.find((entry) => entry.method === 'Cash')?.amount).toBe(20)
    expect(methods.find((entry) => entry.method === 'Card')?.amount).toBe(0)
  })

  it('admits money whose method was never recorded rather than dropping it', () => {
    const methods = collectedByPaymentMethod([
      invoice({
        totalPrice: 100,
        amountPaid: 100,
        advanceAmount: 0,
        finalPaymentType: null,
      }),
    ])

    expect(
      methods.find((entry) => entry.method === 'Not recorded')?.amount,
    ).toBe(100)
  })

  it('leaves out the unrecorded row when everything is accounted for', () => {
    const methods = collectedByPaymentMethod([invoice()])

    expect(methods.some((entry) => entry.method === 'Not recorded')).toBe(false)
  })
})

describe('orderValueByBranch', () => {
  it('ranks branches by order value and names the gap', () => {
    const branches = orderValueByBranch([
      order({ receivingLocation: 'Manama', price: 40 }),
      order({ id: 'ord-2', receivingLocation: 'Riffa', price: 90 }),
      order({ id: 'ord-3', receivingLocation: null, price: 10 }),
    ])

    expect(branches.map((entry) => entry.branch)).toEqual([
      'Riffa',
      'Manama',
      'Unassigned',
    ])
    expect(branches[0].orders).toBe(1)
  })
})

describe('topMaterialsByValue', () => {
  it('folds everything past the cut into one Other row', () => {
    const orders = ['A', 'B', 'C', 'D'].map((name, index) =>
      order({
        id: `ord-${index}`,
        material: name,
        price: 100 - index * 10,
        materialAmount: 2,
      }),
    )

    const ranked = topMaterialsByValue(orders, 2)

    expect(ranked.map((entry) => entry.material)).toEqual(['A', 'B', 'Other'])
    expect(ranked[2].value).toBe(80 + 70)
    expect(ranked[2].orders).toBe(2)
    expect(ranked[2].metres).toBe(4)
  })

  it('leaves a short list alone', () => {
    const ranked = topMaterialsByValue([order({ material: 'A' })], 8)

    expect(ranked.map((entry) => entry.material)).toEqual(['A'])
  })

  it('accumulates repeat orders of the same material', () => {
    const ranked = topMaterialsByValue([
      order({ material: 'Cotton', price: 40, materialAmount: 3 }),
      order({ id: 'ord-2', material: 'Cotton', price: 20, materialAmount: 1 }),
    ])

    expect(ranked[0]).toMatchObject({ value: 60, metres: 4, orders: 2 })
  })
})

describe('materialDemandVsStock', () => {
  it('pairs metres used with metres on hand across every location', () => {
    const demand = materialDemandVsStock(
      [order({ material: 'Cotton', materialAmount: 3 })],
      [
        material({
          locations: [
            { locationId: 'loc-1', location: 'Manama', quantity: 12 },
            { locationId: 'loc-2', location: 'Riffa', quantity: 8 },
          ],
        }),
      ],
    )

    expect(demand).toEqual([{ material: 'Cotton', used: 3, stock: 20 }])
  })

  it('still shows a material that is being used but has no stock left', () => {
    const demand = materialDemandVsStock(
      [order({ material: 'Linen', materialAmount: 5 })],
      [material()],
    )

    expect(demand).toEqual([{ material: 'Linen', used: 5, stock: 0 }])
  })
})

describe('workInProgressByStage', () => {
  const cutting = stage({ name: 'Cutting', sortOrder: 1 })
  const sewing = stage({ name: 'Sewing', sortOrder: 2, status: 'pending' })

  it('counts unfinished orders at the stage they are waiting on', () => {
    const load = workInProgressByStage([
      order({
        id: 'a',
        currentStage: 'Sewing',
        stages: [cutting, sewing],
      }),
      order({
        id: 'b',
        currentStage: 'Sewing',
        stages: [cutting, sewing],
      }),
      order({
        id: 'c',
        currentStage: 'Cutting',
        stages: [
          stage({ name: 'Cutting', sortOrder: 1, status: 'pending' }),
          sewing,
        ],
      }),
    ])

    expect(load).toEqual([
      { stage: 'Not started', orders: 1 },
      { stage: 'Sewing', orders: 2 },
    ])
  })

  it('leaves finished orders out of the queue', () => {
    const load = workInProgressByStage([
      order({ currentStage: null, stages: [cutting] }),
    ])

    expect(load).toEqual([])
  })
})

describe('averageStageDuration', () => {
  it('averages recorded stages and reports the sample size', () => {
    const durations = averageStageDuration([
      order({
        stages: [
          stage({
            name: 'Cutting',
            startedAt: '2026-08-01T00:00:00Z',
            completedAt: '2026-08-01T04:00:00Z',
          }),
          stage({
            name: 'Sewing',
            sortOrder: 2,
            startedAt: '2026-08-01T04:00:00Z',
            completedAt: '2026-08-02T04:00:00Z',
          }),
        ],
      }),
      order({
        id: 'ord-2',
        stages: [
          stage({
            name: 'Cutting',
            startedAt: '2026-08-03T00:00:00Z',
            completedAt: '2026-08-03T02:00:00Z',
          }),
        ],
      }),
    ])

    expect(durations).toEqual([
      { stage: 'Cutting', hours: 3, samples: 2 },
      { stage: 'Sewing', hours: 24, samples: 1 },
    ])
  })

  it('measures nothing from a skipped or outstanding stage', () => {
    const durations = averageStageDuration([
      order({
        stages: [
          stage({ name: 'Cutting', status: 'skipped' }),
          stage({
            name: 'Sewing',
            sortOrder: 2,
            status: 'pending',
            completedAt: null,
          }),
        ],
      }),
    ])

    expect(durations).toEqual([])
  })
})

describe('orderCompletedAt', () => {
  it('is the last stage recorded, for an order that is through', () => {
    const finished = orderCompletedAt(
      order({
        currentStage: null,
        stages: [
          stage({ completedAt: '2026-08-01T04:00:00Z' }),
          stage({ name: 'Sewing', completedAt: '2026-08-05T09:00:00Z' }),
        ],
      }),
    )

    expect(finished?.toISOString()).toBe('2026-08-05T09:00:00.000Z')
  })

  it('is nothing while a stage is still outstanding', () => {
    expect(orderCompletedAt(order({ currentStage: 'Sewing' }))).toBeNull()
  })
})

describe('throughput', () => {
  const now = new Date('2026-08-14T12:00:00Z')
  const range = periodRange('12m', now)
  const buckets = buildBuckets(range, null)

  it('counts intake by order date and output by completion date', () => {
    const points = throughput(
      [
        order({
          invoiceDate: new Date('2026-07-02T00:00:00Z'),
          currentStage: null,
          stages: [stage({ completedAt: '2026-08-04T00:00:00Z' })],
        }),
        order({
          id: 'ord-2',
          invoiceDate: new Date('2026-08-06T00:00:00Z'),
          currentStage: 'Sewing',
          stages: [stage({ status: 'pending', completedAt: null })],
        }),
      ],
      buckets,
      range.bucket,
    )

    const august = points[points.length - 1]
    const july = points[points.length - 2]

    expect(july).toMatchObject({ placed: 1, completed: 0 })
    expect(august).toMatchObject({ placed: 1, completed: 1 })
  })
})

describe('repairBreakdown', () => {
  const repair = (status: 'open' | 'completed') => ({
    id: `rep-${status}`,
    reason: 'Sleeve',
    reportedOn: '2026-08-02',
    charge: 0,
    status,
    completedAt: null,
    notes: null,
  })

  it('counts every status and rates rework by orders, not repairs', () => {
    const breakdown = repairBreakdown([
      order({ id: 'a', repairs: [repair('open'), repair('completed')] }),
      order({ id: 'b', repairs: [] }),
      order({ id: 'c', repairs: [] }),
      order({ id: 'd', repairs: [] }),
    ])

    expect(breakdown.total).toBe(2)
    expect(breakdown.outstanding).toBe(1)
    expect(breakdown.reworkRate).toBe(25)
    expect(breakdown.statuses).toEqual([
      { status: 'open', label: 'Open', count: 1 },
      { status: 'in_progress', label: 'In progress', count: 0 },
      { status: 'completed', label: 'Completed', count: 1 },
      { status: 'cancelled', label: 'Cancelled', count: 0 },
    ])
  })

  it('rates nothing at zero rather than NaN', () => {
    expect(repairBreakdown([]).reworkRate).toBe(0)
  })
})

describe('completedOrderCount', () => {
  it('counts orders with no stage left outstanding', () => {
    expect(
      completedOrderCount([
        order({ id: 'a', currentStage: null }),
        order({ id: 'b', currentStage: 'Sewing' }),
      ]),
    ).toBe(1)
  })
})
