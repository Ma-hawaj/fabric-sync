import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/invoices')({
  staticData: { title: 'Invoices' },
  component: Outlet,
})
