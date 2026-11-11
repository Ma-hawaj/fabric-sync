export function businessTime(
  value: string,
  timezone: string,
  seconds = false,
): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}${seconds ? `:${part('second')}` : ''}`
}
export function fromBusinessTime(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw new Error('Enter a valid date and time.')
  const seconds = value.length === 19
  const suffix = seconds ? 'Z' : ':00Z'
  const wall = Date.parse(`${value}${suffix}`)
  if (!Number.isFinite(wall)) throw new Error('Enter a valid date and time.')
  const candidates = new Set<string>()
  for (const hours of [-24, 0, 24]) {
    const probe = wall + hours * 3600000
    const local = Date.parse(
      `${businessTime(new Date(probe).toISOString(), timezone, seconds)}${suffix}`,
    )
    const candidate = new Date(wall - (local - probe)).toISOString()
    if (businessTime(candidate, timezone, seconds) === value)
      candidates.add(candidate)
  }
  if (candidates.size !== 1)
    throw new Error(
      'This time is skipped or repeated by a clock change. Choose another time.',
    )
  return [...candidates][0]
}
