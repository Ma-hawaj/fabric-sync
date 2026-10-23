import { createFileRoute, redirect } from '@tanstack/react-router'

// Existing bookmarks land on the inventory page, where stock is now added in a dialog.
export const Route = createFileRoute('/_authenticated/inventory/new')({
  beforeLoad: () => {
    throw redirect({ to: '/inventory' })
  },
})
