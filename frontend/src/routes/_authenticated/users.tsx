import { DataTable } from '#/components/data-table/data-table'
import { DataTableToolbar } from '#/components/data-table/data-table-toolbar'
import { userColumns } from '#/features/users/components/user-columns'
import { useUsers } from '#/features/users/hooks/use-users'
import { useDataTable } from '#/hooks/use-data-table'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/users')({
  component: Users,
  staticData: {
    title: 'Users',
  },
})

function Users() {
  const { data: users = [], isLoading } = useUsers()

  const { table } = useDataTable({
    data: users,
    columns: userColumns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-5 [&>:first-child]:shrink-0"
    >
      <div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          Users
        </h1>
        <p className="mt-1.5 hidden text-sm leading-relaxed text-muted-foreground sm:block">
          View all Users.
        </p>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableToolbar table={table} />
      </DataTable>
    </div>
  )
}
