import type * as AuthModule from './lib/auth'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// Existing workflow tests exercise an authorized operator. Authorization tests
// override this fixture explicitly to cover each independent role and denial.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>()
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      isAuthenticated: true,
      isLoading: false,
      error: null,
      user: {
        id: 'test-admin',
        name: 'Test Admin',
        email: 'admin@example.com',
        roles: ['admin'],
      },
      signIn: vi.fn(),
      signOut: vi.fn(),
    })),
  }
})
