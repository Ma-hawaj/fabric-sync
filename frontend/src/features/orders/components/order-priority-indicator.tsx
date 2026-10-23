import { FlagIcon } from 'lucide-react'

export function OrderPriorityIndicator({ isUrgent }: { isUrgent: boolean }) {
  if (!isUrgent) return null

  return (
    <span
      role="img"
      aria-label="Urgent order"
      title="Urgent order"
      className="inline-flex shrink-0 text-warning"
    >
      <FlagIcon className="size-3.5" aria-hidden="true" />
    </span>
  )
}
