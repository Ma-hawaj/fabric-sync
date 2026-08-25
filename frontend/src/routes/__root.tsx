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
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-6">
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
      <SidebarInset>
        <Header />
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
          <Outlet />
        </div>
      </SidebarInset>
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
      <Toaster />
    </NuqsAdapter>
  )
}
