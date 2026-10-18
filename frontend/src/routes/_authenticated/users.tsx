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
    <div className="list-page">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="list-description">View all Users.</p>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableToolbar table={table} />
      </DataTable>
    </div>
  )
}
