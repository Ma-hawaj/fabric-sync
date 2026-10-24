import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountSettingsUrl } from './account-settings'

afterEach(() => vi.unstubAllEnvs())

describe('account settings URL', () => {
  it.each([
    ['http://localhost:8080', 'http://localhost:8080/ui/console/users/me'],
    [
      'https://auth.example.com/',
      'https://auth.example.com/ui/console/users/me',
    ],
    [
      'https://team.zitadel.cloud',
      'https://team.zitadel.cloud/ui/console/users/me',
    ],
    [
      ' https://auth.example.com ',
      'https://auth.example.com/ui/console/users/me',
    ],
    [
      'https://auth.example.com/application/o/fabric-sync/',
      'https://auth.example.com/if/user/',
    ],
  ])('derives the account page for %s', (authority, expected) => {
    vi.stubEnv('VITE_ACCOUNT_URL', '')
    vi.stubEnv('VITE_OIDC_AUTHORITY', authority)
    expect(accountSettingsUrl()).toBe(expected)
  })

  it('uses the explicit account URL before deriving one from the issuer', () => {
    vi.stubEnv('VITE_OIDC_AUTHORITY', 'https://auth.example.com')
    vi.stubEnv('VITE_ACCOUNT_URL', ' https://accounts.example.com/settings ')
    expect(accountSettingsUrl()).toBe('https://accounts.example.com/settings')
  })

  it('derives the default when the override contains only whitespace', () => {
    vi.stubEnv('VITE_OIDC_AUTHORITY', 'http://localhost:8080')
    vi.stubEnv('VITE_ACCOUNT_URL', '  ')
    expect(accountSettingsUrl()).toBe(
      'http://localhost:8080/ui/console/users/me',
    )
  })

  it.each([
    '',
    'invalid',
    'file:///identity',
    'https://auth.example.com/realms/company',
  ])(
    'hides the link when the issuer cannot supply a default: %s',
    (authority) => {
      vi.stubEnv('VITE_ACCOUNT_URL', '')
      vi.stubEnv('VITE_OIDC_AUTHORITY', authority)
      expect(accountSettingsUrl()).toBeNull()
    },
  )
})
