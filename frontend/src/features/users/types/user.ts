// A person who can be assigned work — an order stage, currently. `id` is a
// plain string because it holds an Authentik user UUID from the backend's
// real user directory, not an id this app generates. `avatarUrl` is whatever
// Authentik's `avatar` field carries (an `http(s)` URL or a `data:` URI);
// `roles`/`groups` hold the assigned Authentik role/group names.
export interface User {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  roles: string[]
  groups: string[]
}
