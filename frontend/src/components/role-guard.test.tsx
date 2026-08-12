import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoleGuard } from './role-guard'
import type * as AuthModule from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'

const useAuthMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof AuthModule>('@/lib/auth')
  return { ...actual, useAuth: () => useAuthMock() }
})

function authState(user: AuthUser | null) {
  return {
    isAuthenticated: user !== null,
    isLoading: false,
    user,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }
}

describe('RoleGuard', () => {
  it('renders children when the user holds the required role', () => {
    useAuthMock.mockReturnValue(
      authState({ name: 'Ahmed', email: 'a@example.com', roles: ['admin'] }),
    )

    render(
      <RoleGuard role="admin">
        <p>secret</p>
      </RoleGuard>,
    )

    expect(screen.queryByText('secret')).toBeTruthy()
  })

  it('renders the fallback when the user lacks the required role', () => {
    useAuthMock.mockReturnValue(
      authState({ name: 'Ahmed', email: 'a@example.com', roles: ['viewer'] }),
    )

    render(
      <RoleGuard role="admin" fallback={<p>nope</p>}>
        <p>secret</p>
      </RoleGuard>,
    )

    expect(screen.queryByText('secret')).toBeNull()
    expect(screen.queryByText('nope')).toBeTruthy()
  })

  it('renders nothing by default when there is no fallback', () => {
    useAuthMock.mockReturnValue(authState(null))

    const { container } = render(
      <RoleGuard role="viewer">
        <p>secret</p>
      </RoleGuard>,
    )

    expect(container.textContent).toBe('')
  })

  it('renders when the user holds any one of several accepted roles', () => {
    useAuthMock.mockReturnValue(
      authState({ name: 'Ahmed', email: 'a@example.com', roles: ['staff'] }),
    )

    render(
      <RoleGuard role={['admin', 'staff']}>
        <p>secret</p>
      </RoleGuard>,
    )

    expect(screen.queryByText('secret')).toBeTruthy()
  })
})
