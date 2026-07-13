import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }
  },
  component: Dashboard,
})

function Dashboard() {
  const { signOut } = Route.useRouteContext().auth

  return (
    <section className="grid gap-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Authenticated
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">
          Dashboard
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          This route is only available after a bearer token is stored in the
          frontend auth context.
        </p>
      </div>
      <div className="flex gap-3">
        <Link to="/users" className={cn(buttonVariants())}>
          Open users
        </Link>
        <Button type="button" variant="outline" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </section>
  )
}
