import type { ReactNode } from 'react'
import { hasRole, useAuth } from '@/lib/auth'
import type { Role } from '@/lib/auth'

type RoleGuardProps = {
  /** Role, or any-of a set of roles, required to render `children`. */
  role: Role | Role[]
  /** Rendered instead of `children` when the current user lacks the role. */
  fallback?: ReactNode
  children: ReactNode
}

/** Wraps UI that should only render for users holding (at least) `role`. */
export function RoleGuard({ role, fallback = null, children }: RoleGuardProps) {
  const { user } = useAuth()
  const required = Array.isArray(role) ? role : [role]

  if (!required.some((r) => hasRole(user, r))) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
