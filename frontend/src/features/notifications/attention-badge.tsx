import { useNotificationAttentionSummary } from './hooks/use-notification-attention'

export function NotificationAttentionBadge() {
  const { data, isError } = useNotificationAttentionSummary()
  if (isError || !data?.total) return null
  return (
    <span
      aria-label={`${data.total} notifications need attention`}
      className="ms-auto rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive tabular-nums group-data-[collapsible=icon]:hidden"
    >
      {data.total > 99 ? '99+' : data.total}
    </span>
  )
}
