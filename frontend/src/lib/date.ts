import { parseISO } from 'date-fns'

/** Calendar dates stay on their written day; timestamps retain their offset. */
export function parseDate(value: Date | string | number): Date {
  return typeof value === 'string' ? parseISO(value) : new Date(value)
}

/** A calendar date in the viewer's time zone, for date fields and comparisons. */
export function localDateString(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
