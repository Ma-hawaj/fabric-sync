import { UserManager, WebStorageStateStore } from 'oidc-client-ts'

// Checked eagerly rather than left to fail deep inside oidc-client-ts:
// a missing authority/client_id doesn't throw there, it makes
// signinRedirect() reject with an opaque error once a protected route
// triggers it — surfacing it upfront gives a message that actually names
// the missing env var.
export function oidcConfigError(): string | null {
  if (!import.meta.env.VITE_OIDC_AUTHORITY) {
    return 'VITE_OIDC_AUTHORITY is not set. Copy frontend/.env.example to frontend/.env and fill in the OIDC vars.'
  }
  if (!import.meta.env.VITE_OIDC_CLIENT_ID) {
    return 'VITE_OIDC_CLIENT_ID is not set. Create an SPA client in the identity provider console and copy its client ID into frontend/.env (see README "Local Infrastructure").'
  }
  return null
}

// Generic/OIDC-standard env vars — swapping the IdP (Authentik locally,
// Keycloak, etc.) is a config change only, nothing here is provider-specific.
export const oidcUserManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_AUTHORITY,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri:
    import.meta.env.VITE_OIDC_REDIRECT_URI ?? `${window.location.origin}/`,
  post_logout_redirect_uri:
    import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI ??
    `${window.location.origin}/`,
  scope: import.meta.env.VITE_OIDC_SCOPE ?? 'openid profile email',
  // oidc-client-ts defaults this to false, so `profile` would otherwise only
  // reflect whatever claims the IdP chose to embed in the ID token itself
  // rather than calling the standard OIDC userinfo endpoint for the scopes
  // requested above — which is what actually populates the sidebar's user
  // name.
  loadUserInfo: true,
  // sessionStorage (not localStorage): token lifetime is tab-scoped, cleared
  // on tab close.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
})

/**
 * Where the "Account settings" menu item points. There is no local user
 * table — profile edits and password changes happen in the IdP's own
 * self-service page, not in this app.
 *
 * Explicit `VITE_ACCOUNT_URL` wins (any IdP with an account console, e.g.
 * Keycloak's `/realms/<realm>/account/`). Otherwise, when the authority
 * follows Authentik's `/application/o/<slug>/` layout, the account area is
 * derived as `{base}/if/user/` — profile fields, the password-change button
 * and MFA all live there, subject to the brand's user-settings flow. Null
 * when neither resolves, and the menu item is hidden instead of linking
 * nowhere.
 */
export function accountSettingsUrl(): string | null {
  const explicit: string | undefined = import.meta.env.VITE_ACCOUNT_URL
  if (explicit?.trim()) {
    return explicit.trim()
  }
  const authority: string | undefined = import.meta.env.VITE_OIDC_AUTHORITY
  const base = authority?.match(/^(https?:\/\/[^/]+)\/application\/o\//)?.[1]
  return base ? `${base}/if/user/` : null
}

export async function getAccessToken(): Promise<string | null> {
  const user = await oidcUserManager.getUser()
  if (!user || user.expired) {
    return null
  }
  return user.access_token
}
