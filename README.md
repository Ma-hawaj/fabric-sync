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

Routes are defined in `frontend/src/routes`. Protected frontend routes redirect to `/login` when there is no stored bearer token. The login screen stores an access token in local storage and authenticated API calls send it as a bearer token.

For local development with the frontend and backend on different origins, set `VITE_API_BASE_URL` before starting Vite:

```bash
cd frontend
VITE_API_BASE_URL=http://localhost:3001 npm run dev
```
