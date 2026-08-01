import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location, context }) => {
    if (!context.auth.isAuthenticated) {
      await context.auth.signIn(location.href)
      // signinRedirect() navigates the browser away; this throw just halts
      // this render pass in case that hasn't taken visible effect yet.
      throw redirect({ to: location.href })
    }
  },
})
