import type { ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { hasRole } from '@/lib/permissions'
import type { Role } from '@/lib/permissions'

/** Render children for any allowed role. Admin and manager overrides follow
 * the application policy; sales, production and inventory are independent. */
export function RoleGuard({
  role,
  children,
  fallback = null,
}: {
  role: Role | readonly Role[]
  children: ReactNode
  fallback?: ReactNode
}) {
  const { user, isAuthenticated, isLoading } = useAuth()
  return (
    <>
      {!isLoading && isAuthenticated && hasRole(user, role)
        ? children
        : fallback}
    </>
  )
}
