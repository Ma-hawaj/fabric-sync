import { describe, expect, it } from 'vitest'
import { measurementFromSnapshot, snapshotLabel } from './measurement-fields'
import type { Measurement } from '@/features/customers/types/customers'

function makeSnapshot(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm1',
    customerId: 'c1',
    readableId: 'C-23-001',
    date: new Date('2026-07-01'),
    chest: 108,
    frontPocketLengthByWidth: '16x14',
    ...overrides,
  }
}

describe('measurementFromSnapshot', () => {
  it('maps a snapshot into a draft, tagging it with loadedFromId', () => {
    const snapshot = makeSnapshot()
    const draft = measurementFromSnapshot(snapshot)
    expect(draft.loadedFromId).toBe('m1')
    expect(draft.chest).toBe(108)
    expect(draft.frontPocketLengthByWidth).toBe('16x14')
  })

  it("dates the draft today, not the snapshot's original date", () => {
    const snapshot = makeSnapshot({ date: new Date('2020-01-01') })
    const draft = measurementFromSnapshot(snapshot)
    expect(draft.date).toBe(new Date().toISOString().slice(0, 10))
  })

  it('fills unset numeric/string fields with blanks, not undefined or 0', () => {
    const snapshot = makeSnapshot({
      chest: undefined,
      frontPocketLengthByWidth: undefined,
    })
    const draft = measurementFromSnapshot(snapshot)
    expect(draft.chest).toBe('')
    expect(draft.frontPocketLengthByWidth).toBe('')
  })

  it('returns a new draft with body type, medium fit and no loadedFromId when given null', () => {
    const draft = measurementFromSnapshot(null)
    expect(draft.loadedFromId).toBeNull()
    expect(draft.chest).toBe('')
    expect(draft.type).toBe('body')
    expect(draft.fit).toBe('medium')
  })

  it('preserves saved values and leaves missing legacy values blank', () => {
    const draft = measurementFromSnapshot(
      makeSnapshot({ type: 'thobe', fit: 'loose' }),
    )
    expect(draft.type).toBe('thobe')
    expect(draft.fit).toBe('loose')

    for (const missing of [undefined, null, '']) {
      const legacy = measurementFromSnapshot(
        makeSnapshot({ type: missing, fit: missing }),
      )
      expect(legacy.type).toBe('')
      expect(legacy.fit).toBe('')
    }
  })
})

describe('snapshotLabel', () => {
  it('labels the first entry as Current', () => {
    const snapshot = makeSnapshot({ date: new Date('2026-07-12') })
    expect(snapshotLabel(snapshot, 0, 3)).toMatch(/^C-23-001 · Current \(/)
  })

  it('labels later entries as Previous, counting down from the total', () => {
    const snapshot = makeSnapshot({ date: new Date('2025-10-05') })
    // 3 total snapshots, this one at index 1 -> the 2nd-most-recent -> "Previous #2"
    expect(snapshotLabel(snapshot, 1, 3)).toMatch(/^C-23-001 · Previous #2 \(/)
    // index 2 of 3 -> the oldest -> "Previous #1"
    expect(snapshotLabel(snapshot, 2, 3)).toMatch(/^C-23-001 · Previous #1 \(/)
  })
})
