const FRACTIONS = [
  [0.125, '⅛'],
  [0.25, '¼'],
  [0.375, '⅜'],
  [0.5, '½'],
  [0.625, '⅝'],
  [0.75, '¾'],
  [0.875, '⅞'],
] as const

/** Display inch fractions without rounding other decimals or changing text. */
export function formatMeasurement(
  value: number | string | null | undefined,
): string {
  if (value == null) return ''
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value)

  const magnitude = Math.abs(value)
  const whole = Math.trunc(magnitude)
  const fraction = FRACTIONS.find(
    ([amount]) => Math.abs(magnitude - whole - amount) < 1e-9,
  )
  if (!fraction) return String(value)

  const sign = value < 0 ? '-' : ''
  return `${sign}${whole ? `${whole} ` : ''}${fraction[1]}`
}
