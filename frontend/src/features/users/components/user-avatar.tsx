import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { User } from '../types/user'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function UserAvatar({
  user,
  className,
}: {
  user: Pick<User, 'name' | 'avatarUrl'>
  className?: string
}) {
  return (
    <Avatar size="sm" className={className}>
      {user.avatarUrl ? (
        <AvatarImage src={user.avatarUrl} alt={user.name} />
      ) : null}
      {/* Base UI swaps to the fallback automatically when the image is
          missing or fails to load, so a broken Authentik URL degrades to
          initials instead of a broken-image icon. */}
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </Avatar>
  )
}
