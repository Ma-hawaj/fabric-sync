// A person who can be assigned work — an order stage, currently. `id` is a
// plain string because it holds a Zitadel subject (`userId`) from the
// backend's real user directory, not an id this app generates. `avatarUrl`
// is whatever Zitadel's `human.profile.avatarUrl` carries; `roles` holds
// the user's project role keys, and `groups` is always empty (Zitadel has
// no usable groups-of-a-user API — the column stays for shape compat).
export interface User {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  roles: string[]
  groups: string[]
}
