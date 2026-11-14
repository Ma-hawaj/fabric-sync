import { createFileRoute } from '@tanstack/react-router'
import { NotificationsPage } from '@/features/notifications/notifications'

export const Route = createFileRoute('/_authenticated/notifications')({
  component: NotificationsPage,
  staticData: { title: 'Notifications' },
})
