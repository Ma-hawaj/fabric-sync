import type { ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { canAccess, canVisit } from '@/lib/permissions'

export function AccessDenied() {
  return (
    <div role="alert" className="p-8 text-center text-sm text-muted-foreground">
      You do not have permission to access this page.
    </div>
  )
}

/** Guards do not mount unauthorized children, including their data queries. */
export function PermissionGuard({
  method,
  path,
  children,
  fallback = null,
}: {
  method: string
  path: string
  children: ReactNode
  fallback?: ReactNode
}) {
  const { user, isAuthenticated, isLoading } = useAuth()
  return (
    <>
      {!isLoading && isAuthenticated && canAccess(user, method, path)
        ? children
        : fallback}
    </>
  )
}

export function PageGuard({
  pathname,
  children,
}: {
  pathname: string
  children: ReactNode
}) {
  const { user, isAuthenticated, isLoading } = useAuth()
  if (isLoading || !isAuthenticated) return null
  return canVisit(user, pathname) ? <>{children}</> : <AccessDenied />
}
