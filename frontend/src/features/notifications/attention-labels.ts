import type { StatusTone } from '@/components/status-badge'
import type { AttentionStatus, NotificationAttentionRow } from './types'

export const notificationTypeLabels: Record<
  NotificationAttentionRow['kind'],
  string
> = {
  invoice: 'Invoice send',
  invoice_ready: 'Ready',
  repair_ready: 'Repair ready',
  gift_card: 'Gift card',
}

export const notificationTypeOptions = Object.entries(
  notificationTypeLabels,
).map(([value, label]) => ({ value, label }))

export const unsentNotificationLabels: Record<
  NotificationAttentionRow['kind'],
  string
> = {
  invoice: 'Invoice message outstanding',
  invoice_ready: 'Ready but not notified',
  repair_ready: 'Repair ready but not notified',
  gift_card: 'Gift card not sent',
}

export const attentionLabels: Record<AttentionStatus, string> = {
  not_sent: 'Not sent',
  failed: 'Failed',
  uncertain: 'Check delivery',
  delayed: 'Waiting too long',
  queued: 'Queued',
  accepted: 'Accepted by WhatsApp',
  delivered: 'Delivered',
}

export const attentionTones: Record<AttentionStatus, StatusTone> = {
  not_sent: 'warning',
  failed: 'danger',
  uncertain: 'warning',
  delayed: 'warning',
  queued: 'info',
  accepted: 'info',
  delivered: 'success',
}
