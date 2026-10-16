import { describe, expect, it } from 'vitest'
import { createEmptyCustomerForm } from '../types/customer-form'
import type { CustomerFormValues } from '../types/customer-form'
import { customerFormSchema } from './customer-schema'

function values(overrides: Partial<CustomerFormValues>): CustomerFormValues {
  return {
    ...createEmptyCustomerForm(),
    name: 'Ahmed',
    mobileNo: '0500000000',
    ...overrides,
  }
}

function issues(input: CustomerFormValues) {
  const result = customerFormSchema.safeParse(input)
  return result.success ? [] : result.error.issues
}

describe('customerFormSchema', () => {
  it('passes without a measurement when none is added', () => {
    expect(issues(values({ addMeasurement: false }))).toEqual([])
  })

  it('rejects a measurement without a type', () => {
    const input = values({
      addMeasurement: true,
      measurement: {
        ...createEmptyCustomerForm().measurement,
        type: '',
        fit: 'medium',
      },
    })
    const error = issues(input).find((issue) =>
      issue.path.join('.').endsWith('type'),
    )
    expect(error?.message).toMatch(/measurement type/i)
    expect(error?.path).toEqual(['measurement', 'type'])
  })

  it('rejects a measurement without a fit', () => {
    const input = values({
      addMeasurement: true,
      measurement: {
        ...createEmptyCustomerForm().measurement,
        type: 'body',
        fit: '',
      },
    })
    const error = issues(input).find((issue) =>
      issue.path.join('.').endsWith('fit'),
    )
    expect(error?.message).toMatch(/pick a fit/i)
    expect(error?.path).toEqual(['measurement', 'fit'])
  })

  it('rejects a measurement with an unknown type or fit', () => {
    const blank = createEmptyCustomerForm().measurement
    const badType = issues(
      values({
        addMeasurement: true,
        measurement: { ...blank, type: 'shirt', fit: 'medium' },
      }),
    )
    expect(
      badType.some((issue) => issue.path.join('.') === 'measurement.type'),
    ).toBe(true)

    const badFit = issues(
      values({
        addMeasurement: true,
        measurement: { ...blank, type: 'body', fit: 'tight' },
      }),
    )
    expect(
      badFit.some((issue) => issue.path.join('.') === 'measurement.fit'),
    ).toBe(true)
  })

  it('passes a measurement with a known type and fit', () => {
    const input = values({
      addMeasurement: true,
      measurement: {
        ...createEmptyCustomerForm().measurement,
        type: 'thobe',
        fit: 'loose',
      },
    })
    expect(issues(input)).toEqual([])
  })
})
