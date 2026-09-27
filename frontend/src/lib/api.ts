import axios, { isAxiosError } from 'axios'
import { getAccessToken } from './oidc'

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export const apiClient = axios.create({ baseURL: apiBaseUrl })

apiClient.interceptors.request.use(async (config) => {
  const token = await getAccessToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

// Normalizes every HTTP-level failure to `ApiError` here, once, so hooks
// don't each need their own try/catch just to get a `.status` to branch on
// (e.g. a 409 conflict). The message prefers the server's response text —
// error responses are plain-text messages meant to be shown — falling back
// to axios's generic status line when there is no body.
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (isAxiosError(error) && error.response) {
      const data = error.response.data
      const message =
        typeof data === 'string' && data.length > 0 ? data : error.message
      return Promise.reject(new ApiError(message, error.response.status))
    }
    return Promise.reject(error)
  },
)
