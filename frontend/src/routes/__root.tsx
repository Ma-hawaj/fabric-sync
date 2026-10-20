import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import '../styles.css'
import Sidebar from '@/components/sidebar'
import Breadcrumbs from '@/components/breadcrumbs'
import type { AuthState } from '@/lib/auth'
import type { QueryClient } from '@tanstack/react-query'
import { SidebarInset, SidebarTrigger } from '#/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'

type RouterContext = {
  auth: AuthState
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
})

function RootErrorComponent({ error }: { error: Error }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-lg font-semibold text-destructive">
          Something went wrong
        </h1>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="shrink-0 border-b">
      <div className="flex h-12 items-center gap-2 px-3 md:px-4">
        <SidebarTrigger />
        <Breadcrumbs />
      </div>
    </header>
  )
}

function RootComponent() {
  return (
    <NuqsAdapter>
      <Sidebar />
      <SidebarInset className="min-w-0 overflow-hidden">
        <Header />
        <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4 [&>:not([data-slot=list-page])]:mx-auto [&>:not([data-slot=list-page])]:max-w-6xl">
          <Outlet />
        </div>
      </SidebarInset>
      {import.meta.env.DEV && import.meta.env.VITE_SHOW_DEVTOOLS === 'true' && (
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'TanStack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
      )}
      <Toaster />
    </NuqsAdapter>
  )
}
