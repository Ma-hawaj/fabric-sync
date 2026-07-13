import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location: _, context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        // to: '/login',
        // search: {
        //   redirect: location.href,
        // },
        to: '/',
      })
    }
  },
})
