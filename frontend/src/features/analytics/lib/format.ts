import { CURRENCY } from '@/lib/currency'

// Formatting for figures that appear on charts. Axis ticks and table-style
// columns want compact, aligned numbers; a headline figure wants the full
// amount. Kept here so a value reads the same in a tooltip, a direct label
// and a stat tile.

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  maximumFractionDigits: 1,
})

const countFormatter = new Intl.NumberFormat('en-US')

const decimalFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
})

export function formatMoney(amount: number): string {
  return currencyFormatter.format(amount)
}

const wholeCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
})

/**
 * For axis ticks, where the full amount won't fit. Compact notation only
 * kicks in above five figures: an axis reading 250 / 500 / 750 / 1K mixes two
 * ways of writing a number down one column.
 */
export function formatMoneyAxis(amount: number): string {
  return Math.abs(amount) >= 10_000
    ? compactCurrencyFormatter.format(amount)
    : wholeCurrencyFormatter.format(amount)
}

export function formatCount(value: number): string {
  return countFormatter.format(value)
}

export function formatMetres(value: number): string {
  return `${decimalFormatter.format(value)} m`
}

export function formatPercent(value: number): string {
  return `${decimalFormatter.format(value)}%`
}

/** A signed percentage, for a period-on-period delta. */
export function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${decimalFormatter.format(Math.abs(value))}%`
}

/**
 * Wall-clock time at a readable scale — minutes for a stage that takes an
 * hour, days for one that takes a week. Stage durations span both.
 */
export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 48) return `${decimalFormatter.format(hours)} h`
  return `${decimalFormatter.format(hours / 24)} d`
}
