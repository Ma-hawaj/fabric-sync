import {
  Link,
  Outlet,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import '../styles.css'
import Sidebar from '@/components/sidebar'
import Breadcrumbs from '@/components/breadcrumbs'
import type { AuthState } from '@/lib/auth'
import type { QueryClient } from '@tanstack/react-query'
import { SidebarInset, SidebarTrigger } from '#/components/ui/sidebar'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'

type RouterContext = {
  auth: AuthState
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
})

function Header() {
  const { isAuthenticated } = Route.useRouteContext().auth
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="font-heading text-sm font-semibold tracking-normal"
          >
            Fabric Sync
          </Link>
          <Breadcrumbs />
        </div>
        <nav className="flex items-center gap-1">
          <Link
            to="/dashboard"
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            activeProps={{ className: 'bg-muted text-foreground' }}
          >
            Dashboard
          </Link>
          <Link
            to="/users"
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            activeProps={{ className: 'bg-muted text-foreground' }}
          >
            Users
          </Link>
          {isAuthenticated ? (
            <button
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              type="button"
              onClick={() => {}}
            >
              Sign out
            </button>
          ) : (
            <Link
              to="/"
              search={{ redirect: '/dashboard' }}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{ className: 'bg-muted text-foreground' }}
            >
              Sign in
            </Link>
          )}
        </nav>
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
        <Outlet />
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
    </NuqsAdapter>
  )
}
