// A person who can be assigned work — an order stage, currently. `id` is a
// plain string because it holds an Authentik user UUID from the backend's
// real user directory, not an id this app generates.
export interface User {
  id: string
  name: string
}
