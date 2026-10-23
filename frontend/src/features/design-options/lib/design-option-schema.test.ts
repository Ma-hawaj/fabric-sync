import { describe, expect, it } from 'vitest'
import { designOptionFormSchema } from './design-option-schema'
import { createEmptyDesignOptionForm } from '../types/design-option-form'
import type { DesignOptionFormValues } from '../types/design-option-form'

function values(
  overrides: Partial<DesignOptionFormValues>,
): DesignOptionFormValues {
  return { ...createEmptyDesignOptionForm(), ...overrides }
}

function firstError(input: DesignOptionFormValues) {
  const result = designOptionFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('designOptionFormSchema', () => {
  it('accepts zero or positive design costs and rejects invalid money', () => {
    const input = values({ slug: 'china', label: 'China', sortOrder: 1 })
    for (const cost of [0, 2.5])
      expect(designOptionFormSchema.safeParse({ ...input, cost }).success).toBe(
        true,
      )
    for (const cost of ['', -1, 0.001, Number.NaN, Number.POSITIVE_INFINITY])
      expect(designOptionFormSchema.safeParse({ ...input, cost }).success).toBe(
        false,
      )
  })

  it('accepts an ordinary option with and without an illustration', () => {
    expect(
      firstError(
        values({
          category: 'neck',
          slug: 'china',
          label: 'CHINA',
          sortOrder: 29,
          imageDataUrl: 'data:image/webp;base64,UklGRg==',
        }),
      ),
    ).toBeNull()
    expect(
      firstError(
        values({
          category: 'emd',
          slug: '6',
          label: '6',
          sortOrder: 6,
          imageDataUrl: null,
        }),
      ),
    ).toBeNull()
  })

  it('requires a category', () => {
    const error = firstError(
      values({
        category: '',
        slug: 'china',
        label: 'CHINA',
        sortOrder: 29,
      }),
    )
    expect(error?.message).toMatch(/pick a design category/i)
    expect(error?.path).toEqual(['category'])
  })

  it('requires an id and a label', () => {
    const id = firstError(
      values({ category: 'neck', slug: '   ', label: 'CHINA', sortOrder: 29 }),
    )
    expect(id?.message).toMatch(/enter an option id/i)
    expect(id?.path).toEqual(['slug'])

    const label = firstError(
      values({ category: 'neck', slug: 'china', label: '  ', sortOrder: 29 }),
    )
    expect(label?.message).toMatch(/enter a display label/i)
    expect(label?.path).toEqual(['label'])
  })

  it('requires a position', () => {
    const error = firstError(
      values({
        category: 'neck',
        slug: 'china',
        label: 'CHINA',
        sortOrder: '',
      }),
    )
    expect(error?.message).toMatch(/enter a position/i)
    expect(error?.path).toEqual(['sortOrder'])
  })

  it('rejects a position below one', () => {
    const error = firstError(
      values({ category: 'neck', slug: 'china', label: 'CHINA', sortOrder: 0 }),
    )
    expect(error?.message).toMatch(/1 or more/i)
    expect(error?.path).toEqual(['sortOrder'])
  })
})
