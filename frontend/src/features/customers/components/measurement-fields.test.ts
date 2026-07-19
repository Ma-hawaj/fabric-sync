import { describe, expect, it } from 'vitest'
import { measurementFromSnapshot, snapshotLabel } from './measurement-fields'
import type { Measurement } from '@/features/customers/types/customers'

function makeSnapshot(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm1',
    customerId: 'c1',
    date: new Date('2026-07-01'),
    chest: 108,
    cuffling: 'Double Cuff',
    ...overrides,
  }
}

describe('measurementFromSnapshot', () => {
  it('maps a snapshot into a draft, tagging it with loadedFromId', () => {
    const snapshot = makeSnapshot()
    const draft = measurementFromSnapshot(snapshot)
    expect(draft.loadedFromId).toBe('m1')
    expect(draft.chest).toBe(108)
    expect(draft.cuffling).toBe('Double Cuff')
  })

  it("dates the draft today, not the snapshot's original date", () => {
    const snapshot = makeSnapshot({ date: new Date('2020-01-01') })
    const draft = measurementFromSnapshot(snapshot)
    expect(draft.date).toBe(new Date().toISOString().slice(0, 10))
  })

  it('fills unset numeric/string fields with blanks, not undefined or 0', () => {
    const snapshot = makeSnapshot({ chest: undefined, cuffling: undefined })
    const draft = measurementFromSnapshot(snapshot)
    expect(draft.chest).toBe('')
    expect(draft.cuffling).toBe('')
  })

  it('returns a blank draft with no loadedFromId when given null', () => {
    const draft = measurementFromSnapshot(null)
    expect(draft.loadedFromId).toBeNull()
    expect(draft.chest).toBe('')
  })
})

describe('snapshotLabel', () => {
  it('labels the first entry as Current', () => {
    const snapshot = makeSnapshot({ date: new Date('2026-07-12') })
    expect(snapshotLabel(snapshot, 0, 3)).toMatch(/^Current \(/)
  })

  it('labels later entries as Previous, counting down from the total', () => {
    const snapshot = makeSnapshot({ date: new Date('2025-10-05') })
    // 3 total snapshots, this one at index 1 -> the 2nd-most-recent -> "Previous #2"
    expect(snapshotLabel(snapshot, 1, 3)).toMatch(/^Previous #2 \(/)
    // index 2 of 3 -> the oldest -> "Previous #1"
    expect(snapshotLabel(snapshot, 2, 3)).toMatch(/^Previous #1 \(/)
  })
})
