import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/products')({
  staticData: { title: 'Products' },
  component: Outlet,
})
