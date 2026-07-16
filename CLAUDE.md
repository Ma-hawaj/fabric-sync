# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fabric Sync: a Rust (Axum) API backend and a React (TanStack Start) frontend for a tailoring/textile business — customers, measurements, materials, and orders. Backend and frontend are independent projects (`backend/`, `frontend/`) with separate CI workflows, deployed/run separately.

## Commands

### Backend (`cd backend`)

```bash
cargo run                    # run the server (reads config from env, see below)
cargo fmt --check            # formatting check (CI-enforced)
cargo check --all-targets
cargo test --all-targets
```

Local infra (Postgres + Zitadel OIDC issuer) via `docker-compose.yml` at repo root:

```bash
cp .env.example .env
docker compose up -d --wait
```

Migrations live in `backend/migrations` and run automatically at startup (`sqlx::migrate!` in `main.rs`).

`sqlx::query!`/`query_as!` macros check queries against a real schema at **compile time**, using either a live `DATABASE_URL` or the committed offline cache at `backend/.sqlx`. After adding/changing a query, regenerate and commit the cache:

```bash
cargo sqlx prepare
```

`cargo sqlx prepare --check` runs in CI and fails if `backend/.sqlx` is stale — regenerate it any time a query changes, not just when tests fail.

### Frontend (`cd frontend`)

Package manager is **pnpm** (see `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and CI) even though the root README says `npm` — use pnpm.

```bash
pnpm install
pnpm run dev          # vite dev server on :3000
pnpm run build
pnpm run check        # prettier --check .
pnpm run format       # prettier --write . && eslint --fix
pnpm run lint         # eslint
pnpm run test         # vitest run
pnpm exec vitest run <path/to/file.test.ts>   # single test file
```

Routes under `src/routes` are file-based (TanStack Router); `src/routeTree.gen.ts` is generated — don't hand-edit it (`pnpm run generate-routes` / `tsr generate` regenerates it, and the vite plugin also regenerates on dev/build).

To point the dev server at a backend running on a different origin/port:

```bash
VITE_API_BASE_URL=http://localhost:3001 pnpm run dev
```

## Backend architecture

- **Feature-module layout**: each domain feature lives under `backend/src/features/<name>/` with `routes.rs` (axum `Router`), `handlers.rs` (extract request data, call service), `service.rs` (business logic), `repository.rs` (sqlx queries), `types.rs` (DTOs). Follow this layering for new features — don't put query logic in handlers or business logic in repository.
- `app.rs` merges each feature's router and applies shared layers (currently just `TraceLayer`) onto `AppState`.
- `AppState` (`state.rs`) holds `Config`, the `PgPool`, and `TokenIntrospection`, and is the single piece of shared state injected into handlers via axum's `State` extractor.
- **Auth**: `auth.rs` implements OAuth2/OIDC token introspection (`TokenIntrospection::discover` does OIDC discovery or uses `OAUTH_INTROSPECTION_URL` directly; `require_auth` is an axum middleware that validates the bearer token and inserts `AuthenticatedUser` as a request extension). **Currently the `require_auth` middleware and its imports are commented out in `app.rs`** — routes are not actually protected yet even though the handler (`handlers::list_customers`) already extracts `Extension<AuthenticatedUser>`. When wiring up new protected routes, re-enable/extend the `route_layer(middleware::from_fn_with_state(...))` pattern there rather than inventing a new mechanism.
- **Errors**: all fallible backend code returns `Result<_, AppError>` (`error.rs`), a single enum with `From` impls for `io::Error`, `sqlx::Error`, and `sqlx::migrate::MigrateError`, and one `IntoResponse` impl. Add new variants there rather than converting to strings/status codes ad hoc in handlers.
- Config (`config.rs`) is read once from env vars at startup into a plain struct (`Config::from_env()`); there's no config file or hot-reload — add new settings as additional env-var-backed fields.

## Frontend architecture

- **Feature-module layout** mirrors the backend: `src/features/<name>/` contains `<name>.tsx` (page), `components/`, `hooks/`, `types/`. Routes in `src/routes` are thin — they wire a route path to a feature page component.
- **Data fetching is currently mocked**: `src/features/customers/hooks/use-customers.ts` and `src/features/orders/hooks/use-orders.ts` return hardcoded arrays through `useQuery` (with an artificial delay), not real API calls. `src/lib/api.ts` only exports `apiBaseUrl` (from `VITE_API_BASE_URL`) and isn't wired into these hooks yet. When connecting a feature to the real backend, replace the mock `queryFn` with an actual fetch against `apiBaseUrl`.
- **TanStack Query setup**: a single `QueryClient` is created once in `main.tsx` and passed both to `QueryClientProvider` (for component-level `useQuery`/`useMutation`) and into the router's context (`router.tsx`/`main.tsx`'s `<App>`) so route `loader`s can also use it (e.g. `context.queryClient.ensureQueryData(...)`). There's no central query-key or query-options registry yet — each feature hook (`use-customers.ts`, `use-orders.ts`) defines its own `queryKey`/`queryFn`/`staleTime` inline and is the unit other components import (e.g. `customers.tsx` calls `useCustomers()`); follow that per-feature-hook pattern for new data, and keep `staleTime` explicit (existing hooks use 5 minutes) rather than relying on the default.
- **Auth is currently stubbed**: `src/lib/auth.tsx`'s `AuthProvider` hardcodes `isAuthenticated: true` — there is no real login flow or stored bearer token yet, despite the root README describing one. `src/routes/_authenticated.tsx` guards routes via `beforeLoad` using this stubbed `context.auth`, with its redirect-to-`/login` path commented out in favor of redirecting to `/`. Don't assume a working login screen exists; check this file before building on top of auth state.
- Protected pages live under `src/routes/_authenticated/` (customers, orders, users); `src/routes/index.tsx` and `dashboard.tsx` are outside that guard.
- UI primitives: `src/components/ui/` are local shadcn/Base UI-style primitives (not a node_modules package) — extend/copy this pattern for new primitives rather than pulling in a component library. `src/components/data-table/` is a reusable TanStack Table wrapper (toolbar, filters, column header, pagination) used by both customers and orders feature tables; prefer composing from there over building bespoke table UI.
- **Adding shadcn components**: `shadcn` is a project devDependency (not a one-off `dlx` install), configured via `components.json` (style `base-rhea`, base color `neutral`, icon library `lucide`, `rtl: true`). Add a new primitive with:

  ```bash
  cd frontend
  pnpm exec shadcn add <component>
  ```

  This writes into `src/components/ui/` using the aliases in `components.json` (`@/components`, `@/lib`, `@/hooks`, etc.) — run it from `frontend/` so paths resolve correctly, and expect it to match the existing hand-styled primitives already there rather than pulling in Radix/shadcn defaults wholesale.
- Styling: Tailwind CSS 4 via the `@tailwindcss/vite` plugin (no separate Tailwind config file to edit — see `src/styles.css` for theme tokens).

## Database schema notes

`backend/migrations/20260712000000_create_tables.sql` defines `branch`, `customers`, `materials`, `invoices`, `measurements`, `orders`. `measurements` has three repeated groups of thobe-detail columns (`*_1`, `*_2`, `*_3`) for tracking style changes across visits — the `Measurement` type/query in `features/customers/repository.rs` maps all of them individually (SQLx casts most numeric columns to `float8` and id columns to `text` in the query itself). Only `customers` currently has a backend feature; `orders`, `materials`, `invoices`, `branch` exist in the schema but have no backend routes yet (frontend orders data is fully mocked).

## CI

Both `backend.yml` and `frontend.yml` are path-filtered (only run when their directory or the workflow file changes) and gate on: backend — `sqlx migrate run` against a real Postgres service container, then `cargo sqlx prepare --check`, `cargo fmt --check`, `cargo check --all-targets`, `cargo test --all-targets`; frontend — `pnpm run check` (prettier), `pnpm run lint`, `vitest run --passWithNoTests`, `pnpm run build`.
