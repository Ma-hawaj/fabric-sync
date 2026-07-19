import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

export type AuthUser = {
  name: string
  email: string
  avatarUrl?: string
}

export type AuthState = {
  isAuthenticated: boolean
  user: AuthUser | null
  signOut: () => void
}

const mockUser: AuthUser = {
  name: 'Aisha Al Mansoori',
  email: 'aisha@fabricsync.com',
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: true,
      user: mockUser,
      signOut: () => {},
    }),
    [],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return auth
}
