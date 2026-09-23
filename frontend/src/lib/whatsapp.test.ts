import { describe, expect, it } from 'vitest'
import { normalizePhoneNumber } from './whatsapp'

describe('normalizePhoneNumber', () => {
  it('keeps only the digits', () => {
    expect(normalizePhoneNumber('+973-3311-2233')).toBe('97333112233')
    expect(normalizePhoneNumber('973 3311 2233')).toBe('97333112233')
    expect(normalizePhoneNumber('97333112233')).toBe('97333112233')
    expect(normalizePhoneNumber('')).toBe('')
  })
})
