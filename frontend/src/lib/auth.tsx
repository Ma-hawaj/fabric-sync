import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  AuthProvider as OidcAuthProvider,
  useAuth as useOidcAuth,
} from 'react-oidc-context'
import type { User } from 'oidc-client-ts'
import { oidcUserManager } from './oidc'

export type Role = 'admin' | 'staff' | 'viewer'

// Low-to-high, so a higher role satisfies a lower role's gate (an `admin`
// passes a `staff`-or-`viewer` check) — mirrors the hierarchy the backend
// enforces in `backend/src/auth.rs`'s `Role`.
const ROLE_ORDER: Role[] = ['viewer', 'staff', 'admin']

const KNOWN_ROLES = new Set<Role>(ROLE_ORDER)

// Zitadel's project-role assertion claim: a map of role key to
// `{ orgId: orgName }`, present on the ID token profile when the Zitadel
// project has "Assert Roles on Authentication" enabled.
const ZITADEL_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'

function rolesFromProfile(
  profile: Record<string, unknown> | undefined,
): Role[] {
  const claim = profile?.[ZITADEL_ROLES_CLAIM]
  if (!claim || typeof claim !== 'object') return []

  return Object.keys(claim).filter((key): key is Role =>
    KNOWN_ROLES.has(key as Role),
  )
}

export type AuthUser = {
  name: string
  email: string
  avatarUrl?: string
  roles: Role[]
}

export type AuthState = {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  signIn: (returnTo?: string) => Promise<void>
  signOut: () => void
}

/** Whether `user` holds `minimum` or a higher role in the hierarchy above. */
export function hasRole(user: AuthUser | null, minimum: Role): boolean {
  if (!user) return false
  const minimumIndex = ROLE_ORDER.indexOf(minimum)
  return user.roles.some((role) => ROLE_ORDER.indexOf(role) >= minimumIndex)
}

const AuthContext = createContext<AuthState | null>(null)

function onSigninCallback(user: User | undefined) {
  const returnTo =
    (user?.state as { returnTo?: string } | undefined)?.returnTo ?? '/'
  window.history.replaceState({}, document.title, returnTo)
}

function AuthBridge({ children }: { children: ReactNode }) {
  const oidc = useOidcAuth()

  const value = useMemo<AuthState>(() => {
    const profile = oidc.user?.profile

    return {
      isAuthenticated: oidc.isAuthenticated,
      isLoading: oidc.isLoading,
      user: profile
        ? {
            name:
              profile.name ??
              profile.preferred_username ??
              profile.email ??
              'Unknown',
            email: profile.email ?? '',
            avatarUrl: profile.picture,
            roles: rolesFromProfile(profile),
          }
        : null,
      signIn: (returnTo) =>
        oidc.signinRedirect({
          state: { returnTo: returnTo ?? window.location.href },
        }),
      // RP-initiated logout: also ends the IdP's hosted-login session, not
      // just the local token. Without this, signing out locally and hitting
      // a protected route again would silently re-auth via the IdP's still-
      // live session cookie instead of showing a login prompt.
      signOut: () => {
        void oidc.signoutRedirect()
      },
    }
  }, [oidc.isAuthenticated, oidc.isLoading, oidc.user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <OidcAuthProvider
      userManager={oidcUserManager}
      onSigninCallback={onSigninCallback}
    >
      <AuthBridge>{children}</AuthBridge>
    </OidcAuthProvider>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return auth
}
