import { Button } from '@/components/ui/button'
import { createFileRoute, useRouter } from '@tanstack/react-router'

type User = {
  id: number
  name: string
}

export const Route = createFileRoute('/_authenticated/users')({
  loader: async () => {
    return [{ id: 1, name: 'ma' }] as User[]
  },
  component: Users,
  staticData: {
    title: 'Users',
  },
})

function Users() {
  const users = Route.useLoaderData()
  const router = useRouter()

  return (
    <section className="grid gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Protected API
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">Users</h1>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void router.invalidate()}
        >
          Refresh
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Name</th>
            </tr>
          </thead>
          <tbody>
            {users.length > 0 ? (
              users.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {user.id}
                  </td>
                  <td className="px-4 py-3">{user.name}</td>
                </tr>
              ))
            ) : (
              <tr className="border-t">
                <td className="px-4 py-6 text-muted-foreground" colSpan={2}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
