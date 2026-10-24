/** Calendar dates have no time zone; serialize the day selected in the UI. */
export function serializeFilterDate(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Read calendar dates locally and keep existing timestamp-based URLs usable. */
export function parseFilterDate(
  value: string | number | undefined,
): Date | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (parts) {
      const date = new Date(
        Number(parts[1]),
        Number(parts[2]) - 1,
        Number(parts[3]),
      )
      return serializeFilterDate(date) === value ? date : undefined
    }
  }
  const date = new Date(Number(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}
