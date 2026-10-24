import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/design-options')({
  staticData: { title: 'Design Options' },
  component: Outlet,
})
