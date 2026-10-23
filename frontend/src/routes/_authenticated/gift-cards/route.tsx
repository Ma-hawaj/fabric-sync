import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/gift-cards')({
  staticData: { title: 'Gift Cards' },
  component: Outlet,
})
