import policy from './access-policy.json'

export const ROLES = [
  'admin',
  'manager',
  'sales',
  'production',
  'inventory',
] as const
export type Role = (typeof ROLES)[number]
export type Principal = { roles: readonly Role[] } | null | undefined

export function hasRole(
  user: Principal,
  required: Role | readonly Role[],
): boolean {
  const roles = typeof required === 'string' ? [required] : required
  return Boolean(
    user &&
    roles.length > 0 &&
    (user.roles.includes('admin') ||
      (user.roles.includes('manager') &&
        roles.some((role) => role !== 'admin')) ||
      roles.some((role) => user.roles.includes(role))),
  )
}

export function rolesFromProfile(
  profile: Record<string, unknown> | undefined,
  project = import.meta.env.VITE_ZITADEL_PROJECT_ID as string | undefined,
  organization = import.meta.env.VITE_ZITADEL_ORGANIZATION_ID as
    string | undefined,
): Role[] {
  if (!profile || !project || !organization) return []
  // The explicit project claim prevents roles from another project from
  // enabling controls. The backend independently validates the access token.
  const claim = profile[`urn:zitadel:iam:org:project:${project}:roles`]
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return []
  return ROLES.filter((role) => {
    const organizations = (claim as Record<string, unknown>)[role]
    return (
      organizations !== null &&
      typeof organizations === 'object' &&
      !Array.isArray(organizations) &&
      typeof (organizations as Record<string, unknown>)[organization] ===
        'string'
    )
  })
}

function matches(pattern: string, path: string): boolean {
  const actual = path
    .split('?')[0]
    .replace(/^\/api(?=\/)/, '')
    .split('/')
  const expected = pattern.split('/')
  return (
    actual.length === expected.length &&
    expected.every((part, index) =>
      part.startsWith(':') ? Boolean(actual[index]) : part === actual[index],
    )
  )
}

/** The same method/path rules are enforced by the Rust middleware. */
export function canAccess(
  user: Principal,
  method: string,
  path: string,
): boolean {
  const normalizedMethod =
    method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()
  const rule = policy.find(
    (entry) => entry.method === normalizedMethod && matches(entry.path, path),
  )
  return Boolean(
    user &&
    rule &&
    (rule.roles.includes('authenticated') ||
      hasRole(user, rule.roles as Role[])),
  )
}

/** Page access is separate from lookup access: viewing products does not
 * grant inventory management, and staff lookup does not grant directory UI. */
export function canVisit(user: Principal, pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  const [section] = parts
  const editing = parts.includes('new') || parts.includes('edit')
  if (section === 'users') return hasRole(user, 'manager')
  if (
    ['locations', 'order-stages', 'design-options'].includes(section) &&
    editing
  )
    return hasRole(user, 'admin')
  if (['inventory', 'products'].includes(section) && editing)
    return hasRole(user, 'inventory')
  if (section === 'customers' && editing)
    return hasRole(user, ['sales', 'production'])
  const resource = section === 'inventory' ? 'materials' : section
  return Boolean(resource && canAccess(user, 'GET', `/${resource}`))
}

export function homePath(
  user: Principal,
): '/invoices' | '/orders' | '/inventory' | '/customers' {
  if (hasRole(user, 'sales')) return '/invoices'
  if (hasRole(user, 'production')) return '/orders'
  if (hasRole(user, 'inventory')) return '/inventory'
  return '/customers'
}
