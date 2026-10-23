import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/order-stages')({
  staticData: { title: 'Order Stages' },
  component: Outlet,
})
