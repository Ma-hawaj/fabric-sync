import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/customers')({
  staticData: { title: 'Customers' },
  component: Outlet,
})
