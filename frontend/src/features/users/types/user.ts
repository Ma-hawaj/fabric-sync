// A person who can be assigned work — an order stage, currently. `id` is a
// plain string because the backend list is mocked pending real auth; once
// that's wired up it will hold a Zitadel subject rather than an id this app
// generates.
export interface User {
  id: string
  name: string
}
