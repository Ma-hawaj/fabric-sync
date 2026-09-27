import {
  createRouter as createTanStackRouter,
  parseSearchWith,
} from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { QueryClient } from '@tanstack/react-query'

// TanStack Router's default parseSearch JSON-decodes every value. That it is
// destructive for nuqs state like `sort=[{"id":"name","desc":false}]`, which
// arrives back as a real array of objects the nuqs tanstack-router adapter
// re-serializes as `[object Object]`, dropping the sort on the next reconcile.
// Keeping values as raw strings lets nuqs (which owns these URLs through
// `useDataTable`/`useListParams`) parse and round-trip them itself.
const stringSearch = parseSearchWith((value: string) => value)

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    context: {
      auth: undefined!,
      queryClient: undefined!,
    },
    parseSearch: stringSearch,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }

  interface StaticDataRouteOption {
    title?: string
  }
}
