import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location, context }) => {
    if (!context.auth.isAuthenticated) {
      await context.auth.signIn(location.href)
      // signinRedirect() navigates the browser away; this throw just halts
      // this render pass in case that hasn't taken visible effect yet.
      throw redirect({ to: location.href })
    }
  },
  component: AuthenticatedLayout,
})

/**
 * Second half of the auth gate. `beforeLoad` halts navigation into protected
 * pages, but it can't unmount UI that is already on screen — e.g. the
 * session dies (logout, expiry, failed silent renew) while a protected page
 * sits open. Nothing under this layout mounts while unauthenticated, and a
 * context flip alone tears it down.
 */
function AuthenticatedLayout() {
  const { auth } = Route.useRouteContext()

  if (!auth.isAuthenticated) return null
  return <Outlet />
}
