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

`docker-compose.yml` runs a local Zitadel instance (OAuth2/OIDC issuer) and the Postgres database, adapted from the [official Zitadel compose reference](https://github.com/zitadel/zitadel/tree/main/deploy/compose):

```bash
cp .env.example .env
docker compose up -d --wait
```

- Zitadel console: `http://localhost:8080/ui/console`
- Postgres: `postgres://postgres:postgres@localhost:5432/fabric_sync` (matches the backend's default `DATABASE_URL`)

After the stack is up, create two OAuth applications in the Zitadel console, in the same project:

- **Backend introspection client** — confidential (has a client secret). Copy its client ID/secret into `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` for the backend.
- **Frontend SPA client** — public, PKCE, no client secret. Set its redirect URI and post-logout redirect URI to `http://localhost:3000/` (must match `VITE_OIDC_REDIRECT_URI`/`VITE_OIDC_POST_LOGOUT_REDIRECT_URI`), and copy its client ID into `VITE_OIDC_CLIENT_ID` for the frontend.

If a valid access token gets a 401 from the backend unexpectedly, check the `aud` claim Zitadel puts on tokens issued to the SPA client against whatever `OAUTH_RESOURCE_AUDIENCE` is set to — either add the backend's client ID as an audience in Zitadel, or leave `OAUTH_RESOURCE_AUDIENCE` unset locally.

## Backend

The backend reads configuration from environment variables.

Common variables:

- `PORT`, default `3000`
- `DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/fabric_sync`
- `OAUTH_ISSUER_URL` or `OIDC_ISSUER_URL`
- `OAUTH_CLIENT_ID` or `OIDC_CLIENT_ID`
- `OAUTH_CLIENT_SECRET` or `OIDC_CLIENT_SECRET`
- `OAUTH_INTROSPECTION_URL`
- `OAUTH_RESOURCE_AUDIENCE`

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

Copy `frontend/.env.example` to `frontend/.env` and set the OIDC vars for your identity provider (config is generic/OIDC-standard, so any provider works, not just Zitadel):

- `VITE_OIDC_AUTHORITY` — issuer URL
- `VITE_OIDC_CLIENT_ID` — the frontend SPA client's ID (see "Local Infrastructure" above)
- `VITE_OIDC_REDIRECT_URI` / `VITE_OIDC_POST_LOGOUT_REDIRECT_URI`, default `http://localhost:3000/`
- `VITE_OIDC_SCOPE`, default `openid profile email`

For local development with the frontend and backend on different origins, set `VITE_API_BASE_URL` before starting Vite:

```bash
cd frontend
VITE_API_BASE_URL=http://localhost:3001 npm run dev
```
