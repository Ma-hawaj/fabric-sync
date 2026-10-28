import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import type { AuthState } from '@/lib/auth'
import type { Role } from '@/lib/permissions'
import { RoleGuard } from './role-guard'
import { PageGuard, PermissionGuard } from './permission-guard'

function session(roles: Role[], overrides: Partial<AuthState> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    error: null,
    user: { id: 'person', name: 'Person', email: 'person@example.com', roles },
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  })
}
beforeEach(() => session(['sales']))
describe('authorization guards', () => {
  it('does not mount unauthorized children or their queries', () => {
    const mounted = vi.fn()
    function Protected() {
      useEffect(mounted, [])
      return <span>Secret form</span>
    }
    render(
      <RoleGuard role="admin" fallback="Restricted">
        <Protected />
      </RoleGuard>,
    )
    expect(screen.queryByText('Secret form')).toBeNull()
    expect(screen.getByText('Restricted')).toBeTruthy()
    expect(mounted).not.toHaveBeenCalled()
  })
  it('supports any-of roles and manager overrides, but reserves admin actions', () => {
    session(['manager'])
    render(
      <>
        <RoleGuard role={['production', 'inventory']}>Allowed</RoleGuard>
        <RoleGuard role="admin">Admin only</RoleGuard>
      </>,
    )
    expect(screen.getByText('Allowed')).toBeTruthy()
    expect(screen.queryByText('Admin only')).toBeNull()
  })
  it('rechecks permissions when the session changes', () => {
    const { rerender } = render(
      <PermissionGuard method="POST" path="/invoices">
        Create invoice
      </PermissionGuard>,
    )
    expect(screen.getByText('Create invoice')).toBeTruthy()
    session(['production'])
    rerender(
      <PermissionGuard method="POST" path="/invoices">
        Create invoice
      </PermissionGuard>,
    )
    expect(screen.queryByText('Create invoice')).toBeNull()
  })
  it('blocks direct navigation before the form mounts', () => {
    render(
      <PageGuard pathname="/locations/new">
        <span>Location form</span>
      </PageGuard>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Location form')).toBeNull()
  })
  it.each([{ isLoading: true }, { isAuthenticated: false, user: null }])(
    'hides controls during loading and logout',
    (overrides) => {
      session(['admin'], overrides)
      render(<RoleGuard role="sales">Save</RoleGuard>)
      expect(screen.queryByText('Save')).toBeNull()
    },
  )
})
