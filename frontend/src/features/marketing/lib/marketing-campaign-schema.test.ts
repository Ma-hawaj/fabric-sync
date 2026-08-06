import { describe, expect, it } from 'vitest'
import { marketingCampaignFormSchema } from './marketing-campaign-schema'
import { createEmptyCampaignForm } from '../types/campaign-form'
import type { CampaignFormValues } from '../types/campaign-form'

function values(overrides: Partial<CampaignFormValues>): CampaignFormValues {
  return { ...createEmptyCampaignForm(), ...overrides }
}

function firstError(input: CampaignFormValues) {
  const result = marketingCampaignFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('marketingCampaignFormSchema', () => {
  it('accepts an ordinary message', () => {
    expect(firstError(values({ body: 'Eid sale this weekend!' }))).toBeNull()
  })

  it('requires a message', () => {
    const error = firstError(values({ body: '   ' }))
    expect(error?.message).toMatch(/enter a message/i)
    expect(error?.path).toEqual(['body'])
  })

  it('rejects a message over 1024 characters', () => {
    const error = firstError(values({ body: 'a'.repeat(1025) }))
    expect(error?.message).toMatch(/under 1024 characters/i)
    expect(error?.path).toEqual(['body'])
  })

  it('accepts a message at exactly 1024 characters', () => {
    expect(firstError(values({ body: 'a'.repeat(1024) }))).toBeNull()
  })
})
