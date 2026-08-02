import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  AuthProvider as OidcAuthProvider,
  useAuth as useOidcAuth,
} from 'react-oidc-context'
import type { User } from 'oidc-client-ts'
import { oidcUserManager } from './oidc'

export type AuthUser = {
  name: string
  email: string
  avatarUrl?: string
}

export type AuthState = {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  signIn: (returnTo?: string) => Promise<void>
  signOut: () => void
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
