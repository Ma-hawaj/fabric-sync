import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/inventory')({
  staticData: { title: 'Inventory' },
  component: Outlet,
})
