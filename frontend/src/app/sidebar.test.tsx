import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './sidebar'

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/invoices' }),
  Link: ({ to, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props} />
  ),
}))
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: {
      id: 'test-user',
      name: 'Test User',
      email: 'user@example.com',
      roles: ['admin'],
    },
    signOut: vi.fn(),
  }),
}))
vi.mock('@/features/locations/hooks/use-default-location', () => ({
  usePreferences: () => ({ data: undefined }),
}))
vi.mock('@/features/locations/components/default-location-menu', () => ({
  DefaultLocationMenu: () => null,
}))
vi.mock('@/components/theme-menu-items', () => ({
  ThemeMenuItems: () => null,
}))

beforeEach(() => {
  vi.stubEnv('VITE_OIDC_AUTHORITY', 'http://localhost:8080')
  vi.stubEnv('VITE_ACCOUNT_URL', '')
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function openUserMenu() {
  render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Test User/ }))
}

describe('sidebar account settings', () => {
  it('opens the Zitadel profile page in a separate tab', async () => {
    openUserMenu()
    const link = await screen.findByRole('menuitem', {
      name: 'Account settings',
    })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe(
      'http://localhost:8080/ui/console/users/me',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('uses a custom account page when configured', async () => {
    vi.stubEnv('VITE_ACCOUNT_URL', 'https://accounts.example.com/settings')
    openUserMenu()
    const link = await screen.findByRole('menuitem', {
      name: 'Account settings',
    })
    expect(link.getAttribute('href')).toBe(
      'https://accounts.example.com/settings',
    )
  })

  it('hides account settings for an unsupported issuer without an override', async () => {
    vi.stubEnv('VITE_OIDC_AUTHORITY', 'https://auth.example.com/realms/company')
    openUserMenu()
    expect(
      await screen.findByRole('menuitem', { name: 'Sign out' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('menuitem', { name: 'Account settings' }),
    ).toBeNull()
  })
})
