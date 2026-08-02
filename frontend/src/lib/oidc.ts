import { UserManager, WebStorageStateStore } from 'oidc-client-ts'

// Generic/OIDC-standard env vars — swapping the IdP (Zitadel locally,
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
  // sessionStorage (not localStorage): token lifetime is tab-scoped, cleared
  // on tab close.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
})

export async function getAccessToken(): Promise<string | null> {
  const user = await oidcUserManager.getUser()
  if (!user || user.expired) {
    return null
  }
  return user.access_token
}
