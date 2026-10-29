import { homePath } from '@/lib/permissions'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: homePath(context.auth.user) })
  },
})
