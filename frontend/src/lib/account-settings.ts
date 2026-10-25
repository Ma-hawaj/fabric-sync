/**
 * Account maintenance lives in the identity provider. This app defaults to
 * Zitadel's self-service console for root issuers and keeps the legacy
 * Authentik layout working. Other layouts can set VITE_ACCOUNT_URL.
 * https://zitadel.com/docs/concepts/features/selfservice
 */
export function accountSettingsUrl(): string | null {
  const explicit: string | undefined = import.meta.env.VITE_ACCOUNT_URL
  if (explicit?.trim()) return explicit.trim()

  const authority: string | undefined = import.meta.env.VITE_OIDC_AUTHORITY
  if (!authority?.trim()) return null

  try {
    const issuer = new URL(authority.trim())
    if (issuer.protocol !== 'http:' && issuer.protocol !== 'https:') return null

    if (issuer.pathname === '/') {
      return new URL('/ui/console/users/me', issuer).href
    }
    if (/^\/application\/o\/[^/]+\/?$/.test(issuer.pathname)) {
      return new URL('/if/user/', issuer).href
    }
  } catch {
    return null
  }
  return null
}
