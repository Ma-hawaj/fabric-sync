import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { AuthProvider, useAuth } from '@/lib/auth'
import { getRouter } from './router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarProvider } from './components/ui/sidebar'

const router = getRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')!

function App() {
  const auth = useAuth()

  return <RouterProvider router={router} context={{ auth }} />
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <AuthProvider>
      <SidebarProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </SidebarProvider>
    </AuthProvider>,
  )
}
