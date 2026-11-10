import { describe, expect, it } from 'vitest'
import { closingFixture } from '../test-fixtures'
import { salesClosingCsv, salesClosingHtml } from './export-sales-closing'
import { isReportDate } from './sales-closing'

describe('sales closing exports', () => {
  it('exports the selected day, business time, totals, and every event', () => {
    const report = closingFixture()
    const csv = salesClosingCsv(report)
    expect(csv).toContain('"Branch closing report","2026-11-02"')
    expect(csv).toContain('"Branch","Main Branch"')
    expect(csv).toContain('"00:30:00","Invoice issued","1","",110.000')
    expect(csv).toContain('"Net external receipts",52.000')
    expect(csv).toContain('"Refund paid","2","Cash",5.000,"refund-1"')
    const html = salesClosingHtml(report)
    expect(html).toContain('Main Branch · 2026-11-02 · Asia/Bahrain')
    expect(html).toContain('00:30:00')
    expect(html).toContain('Refund paid')
    expect(html).toContain('52.000')
    expect(html).not.toContain('sidebar')
  })
  it('escapes HTML and spreadsheet formulas and handles an empty day', () => {
    const report = closingFixture()
    report.tenders[0].method = '<script>alert(1)</script>'
    report.activity[0].method = '=HYPERLINK("https://example.com")'
    expect(salesClosingHtml(report)).not.toContain('<script>')
    expect(salesClosingHtml(report)).toContain('&lt;script&gt;')
    expect(salesClosingCsv(report)).toContain("'=HYPERLINK")
    report.activity = []
    expect(salesClosingHtml(report)).toContain('No activity for this day.')
  })
  it('accepts only real calendar dates, without browser timezone conversion', () => {
    expect(isReportDate('2024-02-29')).toBe(true)
    expect(isReportDate('2026-02-29')).toBe(false)
    expect(isReportDate('2026-11-02T00:00:00Z')).toBe(false)
    expect(isReportDate('2026-13-01')).toBe(false)
    expect(isReportDate('')).toBe(false)
  })
  it('includes the separately saved opening and active and voided expense history', () => {
    const report = closingFixture()
    report.expenses = [
      {
        id: 'expense-1',
        amount: 5.005,
        paymentType: 'cash',
        reason: 'Delivery fee',
        paidTo: 'Courier',
        reference: 'D100',
        recordedAt: '2026-11-02T09:00:00Z',
        recordedBy: 'staff',
        voidedAt: null,
        voidReason: null,
        voidedBy: null,
      },
      {
        id: 'expense-2',
        amount: 9,
        paymentType: 'cash',
        reason: 'Mistaken entry',
        paidTo: '',
        reference: '',
        recordedAt: '2026-11-02T09:01:00Z',
        recordedBy: 'staff',
        voidedAt: '2026-11-02T09:02:00Z',
        voidReason: 'Duplicate entry',
        voidedBy: 'manager',
      },
    ]
    report.tenders[0].expenses = 5.005
    report.tenders[0].afterExpenses = 46.995
    const csv = salesClosingCsv(report)
    expect(csv).toContain('"Saved opening cash",20.000')
    expect(csv).toContain('"Cash expenses from drawer",5.005')
    expect(csv).toContain('"Delivery fee","Cash",5.005,"Courier","D100"')
    const html = salesClosingHtml(report)
    expect(html).toContain('Delivery fee')
    expect(html).toContain('Voided: Duplicate entry')
  })
})
