import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/orders')({
  staticData: { title: 'Orders' },
  component: Outlet,
})
