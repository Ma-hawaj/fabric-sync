import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { AuthProvider, useAuth } from '@/lib/auth'
import { ThemeProvider } from '@/components/theme-provider'
import { getRouter } from './router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarProvider } from './components/ui/sidebar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const router = getRouter()
const queryClient = new QueryClient()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')!

function AuthErrorScreen({ error }: { error: Error }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-lg font-semibold text-destructive">
          Sign-in failed to start
        </h1>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
    </div>
  )
}

function App() {
  const auth = useAuth()

  if (auth.error) {
    return <AuthErrorScreen error={auth.error} />
  }

  if (auth.isLoading) {
    return null
  }

  return <RouterProvider router={router} context={{ auth, queryClient }} />
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <SidebarProvider>
              <App />
            </SidebarProvider>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}
