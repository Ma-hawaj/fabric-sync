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
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-muted-foreground">View all Users.</p>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground">
          Loading orders...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
