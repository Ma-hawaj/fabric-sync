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

  it.each(['', '   ', '\t\n', '\u2003'])('rejects a blank fit: %j', (fit) => {
    const input = values({
      addMeasurement: true,
      measurement: {
        ...createEmptyCustomerForm().measurement,
        type: 'body',
        fit,
      },
    })
    const error = issues(input).find((issue) =>
      issue.path.join('.').endsWith('fit'),
    )
    expect(error?.message).toMatch(/enter a fit/i)
    expect(error?.path).toEqual(['measurement', 'fit'])
  })

  it('rejects a measurement with an unknown type', () => {
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
  })

  it.each([
    'loose',
    'fit',
    'medium',
    'Slim with extra chest room',
    'واسع',
    '42',
    ' medium ',
  ])('accepts a custom fit: %s', (fit) => {
    const input = values({
      addMeasurement: true,
      measurement: {
        ...createEmptyCustomerForm().measurement,
        type: 'thobe',
        fit,
      },
    })
    expect(issues(input)).toEqual([])
  })
})
