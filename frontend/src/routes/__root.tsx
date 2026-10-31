import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import '../styles.css'
import Sidebar from '@/app/sidebar'
import Breadcrumbs from '@/components/breadcrumbs'
import type { AuthState } from '@/lib/auth'
import type { QueryClient } from '@tanstack/react-query'
import { SidebarInset, SidebarTrigger } from '#/components/ui/sidebar'
import { Toaster } from '@/app/toaster'
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
    <header className="shrink-0 border-b bg-card">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <SidebarTrigger />
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <Breadcrumbs />
        <span className="ms-auto hidden text-[10px] font-medium tracking-widest text-muted-foreground sm:block">
          THOBX ATELIER
        </span>
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
        <div className="workspace-content min-h-0 flex-1 overflow-y-auto p-4 md:p-6 [&>:not([data-slot=list-page])]:mx-auto [&>:not([data-slot=list-page]):not([data-slot=workspace-page])]:max-w-6xl">
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
