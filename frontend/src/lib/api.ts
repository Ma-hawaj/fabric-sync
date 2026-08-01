import { getAccessToken } from './oidc'

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}
