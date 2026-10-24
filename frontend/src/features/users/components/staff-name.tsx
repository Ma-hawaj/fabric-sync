import { useUsers } from '../hooks/use-users'

export function StaffName({ userId }: { userId: string | null | undefined }) {
  const {
    data: users,
    isPending,
    isError,
  } = useUsers({ enabled: Boolean(userId) })
  if (!userId) return <span>Staff not recorded</span>
  const user = users?.find((entry) => entry.id === userId)
  if (user) {
    return (
      <span title={user.email ?? undefined}>
        {user.name.trim() || user.email || 'Staff name unavailable'}
      </span>
    )
  }
  if (isPending) return <span>Loading staff name…</span>
  return (
    <span>
      {isError ? 'Staff directory unavailable' : 'Staff member unavailable'}
    </span>
  )
}
