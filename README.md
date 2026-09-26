# Fabric Sync

Fabric Sync is a full-stack workspace for building a protected data synchronization application. The repository is split into a Rust API backend and a React frontend.

## Repository Structure

```text
.
├── backend/
│   ├── migrations/          # SQLx database migrations
│   ├── src/
│   │   ├── features/        # Feature modules and route handlers
│   │   ├── app.rs           # Axum router composition
│   │   ├── auth.rs          # OAuth2 token introspection middleware
│   │   ├── config.rs        # Environment-backed configuration
│   │   ├── error.rs         # Application error responses
│   │   ├── main.rs          # Server startup, database pool, migrations
│   │   └── state.rs         # Shared application state
│   ├── Cargo.toml
│   └── Cargo.lock
└── frontend/
    ├── public/              # Static browser assets
    ├── src/
    │   ├── components/
    │   │   ├── data-table/  # Reusable data table building blocks
    │   │   ├── ui/          # Base UI / shadcn-style primitives
    │   │   ├── breadcrumbs.tsx
    │   │   └── sidebar.tsx
    │   ├── config/          # Data table and other feature config
    │   ├── features/        # Feature modules (e.g. customers, orders)
    │   │   └── <feature>/
    │   │       ├── components/
    │   │       ├── hooks/
    │   │       ├── types/
    │   │       └── <feature>.tsx
    │   ├── hooks/           # Shared React hooks
    │   ├── lib/             # Shared frontend utilities and auth state
    │   ├── routes/          # TanStack Router file routes
    │   │   └── _authenticated/  # Protected routes
    │   ├── types/           # Shared TypeScript types
    │   ├── main.tsx         # React application bootstrap
    │   ├── router.tsx       # TanStack Router setup
    │   └── styles.css       # Tailwind CSS theme and globals
    ├── package.json
    └── vite.config.ts
```

## Tech Stack

Backend:

- Rust 2021
- Axum for HTTP routing and middleware
- Tokio async runtime
- SQLx with PostgreSQL migrations
- OAuth2/OpenID Connect token introspection for protected routes
- tower-http tracing middleware

Frontend:

- React 19
- Vite
- TanStack Router with file-based routes
- Tailwind CSS 4
- Base UI and local shadcn-style primitives
- ESLint, Prettier, and Vitest

## Local Infrastructure

`docker-compose.yml` runs a local Authentik instance (OAuth2/OIDC issuer) and the Postgres database, following the [official Authentik compose reference](https://docs.goauthentik.io/install-config/install/docker-compose/) with one change: the app and Authentik share a single Postgres server (separate `fabric_sync` and `authentik` databases) instead of running a second Postgres:

```bash
cp .env.example .env
docker compose up -d --wait
```

- Authentik admin UI: `http://localhost:9000/if/admin/` (first boot shows the initial-setup flow that creates the `akadmin` superuser)
- Postgres: `postgres://postgres:postgres@localhost:5432/fabric_sync` (matches the backend's default `DATABASE_URL`)

Migrating from the old Zitadel stack needs a fresh volume (`docker compose down && docker volume rm fabric-sync_postgres-data`).

After the stack is up, create two OAuth2/OIDC providers in the Authentik admin UI, under Applications > Providers:

- **Backend introspection provider** — confidential client type (e.g. name `fabric-sync-api`, no redirect URIs needed). Copy its client ID/secret into `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` for the backend.
- **Frontend SPA provider** — public client type, PKCE (e.g. name `fabric-sync`). Add a redirect URI and post-logout redirect URI for every origin the dev server is opened from (e.g. `http://localhost:3000/` and the Tailscale URL — must match `VITE_OIDC_REDIRECT_URI`/`VITE_OIDC_POST_LOGOUT_REDIRECT_URI` verbatim), and copy its client ID into `VITE_OIDC_CLIENT_ID` for the frontend. Its slug goes into `OAUTH_ISSUER_URL` / `VITE_OIDC_AUTHORITY` (e.g. `http://localhost:9000/application/o/fabric-sync/`).
- **Federation (required)** — on the SPA provider, add the introspection provider under "Federated OAuth2/OpenID Providers". Authentik only lets a confidential provider introspect tokens issued by itself or a federated provider, so without this every API call 401s.

Also set `OAUTH_INTROSPECTION_URL=http://localhost:9000/application/o/introspect/` (Authentik's introspection endpoint is global and isn't advertised by per-provider discovery) and leave `OAUTH_RESOURCE_AUDIENCE` unset — if a valid access token gets a 401, that audience check against a claim Authentik may not send is the first suspect.

`GET /users` (the order-stage assignee picker) is backed by Authentik's user directory: create a service account (Directory > Users > New, type service account), grant it "View user", and mint a token under its Tokens & App passwords into `AUTHENTIK_API_TOKEN` (see `.env.example`).

## Backend

The backend reads configuration from environment variables.

Common variables:

- `PORT`, default `3000` (the local setup below runs the backend on `8000` to stay clear of Vite on `:3000`)
- `DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/fabric_sync`
- `OAUTH_ISSUER_URL` or `OIDC_ISSUER_URL`
- `OAUTH_CLIENT_ID` or `OIDC_CLIENT_ID`
- `OAUTH_CLIENT_SECRET` or `OIDC_CLIENT_SECRET`
- `OAUTH_INTROSPECTION_URL`
- `OAUTH_RESOURCE_AUDIENCE`
- `AUTHENTIK_BASE_URL`, default `http://localhost:9000`
- `AUTHENTIK_API_TOKEN`

Run the backend:

```bash
cd backend
cargo run
```

Check the backend:

```bash
cd backend
cargo fmt --check
cargo check
```

Migrations live in `backend/migrations` and are run at startup through SQLx.

Queries use `sqlx::query!`, which are checked against a real database at compile time. This needs either a running, migrated Postgres reachable via `DATABASE_URL`, or the offline cache committed at `backend/.sqlx` (used automatically when `DATABASE_URL` isn't set). After adding or editing a query, regenerate the cache and commit the result:

```bash
cd backend
cargo install sqlx-cli --version "^0.8" --no-default-features --features postgres,rustls
cargo sqlx prepare
```

`cargo sqlx prepare --check` (run in CI) fails if `backend/.sqlx` is out of sync with the queries in code.

## Frontend

Install dependencies and start the dev server:

```bash
cd frontend
npm install
npm run dev
```

Build and check formatting:

```bash
cd frontend
npm run build
npm run check
```

Routes are defined in `frontend/src/routes`. Protected frontend routes (under `_authenticated/`) redirect straight to the identity provider's hosted login (Authorization Code + PKCE, via `react-oidc-context`/`oidc-client-ts`) when there is no active session — there is no local `/login` page. The access token is held in `sessionStorage` for the tab's lifetime and attached as a bearer token to every backend API call.

Copy `frontend/.env.example` to `frontend/.env` and set the OIDC vars for your identity provider (config is generic/OIDC-standard, so any provider works, not just Authentik):

- `VITE_OIDC_AUTHORITY` — issuer URL (for Authentik, the full provider path including the slug, e.g. `http://localhost:9000/application/o/fabric-sync/`)
- `VITE_OIDC_CLIENT_ID` — the frontend SPA provider's ID (see "Local Infrastructure" above)
- `VITE_OIDC_REDIRECT_URI` / `VITE_OIDC_POST_LOGOUT_REDIRECT_URI`, default `http://localhost:3000/`
- `VITE_OIDC_SCOPE`, default `openid profile email`

API calls are same-origin in dev: `VITE_API_BASE_URL=/api` sends them through the Vite dev-server proxy (`/api` → the backend, prefix rewritten away — see `BACKEND_URL` in `frontend/vite.config.ts`), so frontend and backend share one URL with no CORS involved. To bypass the proxy and hit the backend directly instead:

```bash
cd frontend
VITE_API_BASE_URL=http://localhost:8000 pnpm run dev
```
