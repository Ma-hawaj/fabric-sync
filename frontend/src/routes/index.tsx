import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
  staticData: {
    title: 'Home',
  },
})

function Home() {
  const { isAuthenticated } = Route.useRouteContext().auth

  return (
    <section className="grid gap-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Fabric Sync</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">
          Operational workspace for fabric data synchronization
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Sign in with an access token to reach authenticated views and call the
          protected backend APIs.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          to={isAuthenticated ? '/dashboard' : '/'}
          search={isAuthenticated ? undefined : { redirect: '/dashboard' }}
          className={cn(buttonVariants())}
        >
          {isAuthenticated ? 'Open dashboard' : 'Sign in'}
        </Link>
        <Link
          to="/users"
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          View users
        </Link>
      </div>
    </section>
  )
}
