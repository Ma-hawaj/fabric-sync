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
// (e.g. a 409 conflict).
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (isAxiosError(error) && error.response) {
      return Promise.reject(new ApiError(error.message, error.response.status))
    }
    return Promise.reject(error)
  },
)
