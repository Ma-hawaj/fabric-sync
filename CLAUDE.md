# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fabric Sync: a Rust (Axum) API backend and a React (TanStack Start) frontend for a tailoring/textile business — customers, measurements, materials and their stock, locations, invoices, and orders. Backend and frontend are independent projects (`backend/`, `frontend/`) with separate CI workflows, deployed/run separately.

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

Postgres is pinned to **18+** (`POSTGRES_IMAGE` in `.env`/`.env.example`, and `postgres:18-alpine` in `.github/workflows/backend.yml`) — this is a hard requirement, not just the latest-available tag: schema id defaults use the native `uuidv7()` function, which only exists in Postgres 18+. The compose volume mount is `postgres-data:/var/lib/postgresql` (the whole data dir, not `.../data`) because the official image changed its on-disk layout starting in 18 to support `pg_upgrade --link`; mounting at the old `.../data` path makes 18+ images refuse to start. Bumping the Postgres image tag again always needs a fresh volume (`docker compose down && docker volume rm fabric-sync_postgres-data`) since minor/major version jumps aren't in-place compatible — remember this also resets local Zitadel state, since it shares the same Postgres instance.

Migrations live in `backend/migrations` and run automatically at startup (`sqlx::migrate!` in `main.rs`).

`sqlx::query!`/`query_as!` macros check queries against a real schema at **compile time**, using either a live `DATABASE_URL` or the committed offline cache at `backend/.sqlx`. After adding/changing a query, regenerate and commit the cache:

```bash
cargo sqlx prepare
```

`cargo sqlx prepare --check` runs in CI and fails if `backend/.sqlx` is stale — regenerate it any time a query changes, not just when tests fail.

### Frontend (`cd frontend`)

Package manager is **pnpm** (see `frontend/pnpm-lock.yaml`, `frontend/pnpm-workspace.yaml`, and CI) even though the root README says `npm` — use pnpm.

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
- `app.rs` merges each feature's router (health, customers, materials, locations, invoices, orders) and applies `CorsLayer` (permissive `Any` origin/methods/headers — the frontend origin is never known at compile time and auth is bearer-token rather than cookie based) then `TraceLayer`, onto `AppState`.
- `AppState` (`state.rs`) holds `Config`, the `PgPool`, and `TokenIntrospection`, and is the single piece of shared state injected into handlers via axum's `State` extractor.
- **Auth**: `auth.rs` implements OAuth2/OIDC token introspection (`TokenIntrospection::discover` does OIDC discovery or uses `OAUTH_INTROSPECTION_URL` directly; `require_auth` is an axum middleware that validates the bearer token and inserts `AuthenticatedUser` as a request extension). **The `require_auth` middleware and its imports are commented out in `app.rs`**, while every handler in every domain feature still extracts `Extension<AuthenticatedUser>`. The consequence is worth knowing before you debug anything: with the middleware disabled the extension is never inserted, so **every domain route returns 500** — only `GET /health` responds. That is the current state of the app, not a bug you introduced. When wiring up protected routes, re-enable/extend the `route_layer(middleware::from_fn_with_state(...))` pattern there rather than inventing a new mechanism.
- **Errors**: all fallible backend code returns `Result<_, AppError>` (`error.rs`), a single enum with one `IntoResponse` impl. Variants: `Auth`, `Io`, `Sqlx`, `Migration` (all 500), `NotFound` (404), `Conflict` (409), `BadRequest` (400). Add new variants there rather than converting to strings/status codes ad hoc in handlers.
- **Postgres error codes map to HTTP automatically** in `From<sqlx::Error>`: SQLSTATE `23505` (unique_violation) becomes a 409 `Conflict`, `23503` (foreign_key_violation) becomes a 400 `BadRequest`. Leaning on a database constraint therefore gives you the right status for free — `branch.name`'s `UNIQUE` is what makes a duplicate location name a 409 rather than a 500, with no handler code involved.
- Config (`config.rs`) is read once from env vars at startup into a plain struct (`Config::from_env()`); there's no config file or hot-reload — add new settings as additional env-var-backed fields.

## Frontend architecture

- **Feature-module layout** mirrors the backend: `src/features/<name>/` contains `<name>.tsx` (list page), `components/`, `hooks/`, `types/`, and — where the feature needs them — `lib/` (zod schemas, pricing helpers) and `data/` (static option lists). Form pages sit at the feature root next to the list page (`customer-form.tsx`, `invoice-form.tsx`, `inventory-form.tsx`, `location-form.tsx`). Routes in `src/routes` are thin — they wire a route path to a feature page component.
- **Data fetching is real, not mocked.** Every hook under `src/features/*/hooks/` fetches the backend through `apiBaseUrl`; there are no hardcoded arrays or artificial delays left anywhere. `src/lib/api.ts` is one line — `export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''` — and every hook imports it.
- **TanStack Query setup**: a single `QueryClient` is created once in `main.tsx` and passed both to `QueryClientProvider` (for component-level `useQuery`/`useMutation`) and into the router's context (`router.tsx`/`main.tsx`'s `<App>`) so route `loader`s can also use it (e.g. `context.queryClient.ensureQueryData(...)`). There's no central query-key or query-options registry — each feature hook defines its own `queryKey`/`queryFn`/`staleTime` inline and is the unit other components import (e.g. `customers.tsx` calls `useCustomers()`); follow that per-feature-hook pattern for new data, and keep `staleTime` explicit (every existing hook uses 5 minutes) rather than relying on the default.
- **Query keys are flat and sometimes shared across features**: `['customers']`, `['orders']`, `['invoices']`, `['locations']`, and `['materials']` — the last used by both `inventory/hooks/use-inventory.ts` and `invoices/hooks/use-materials.ts`, which keep separate `Material` types over the same endpoint. Keys are unparameterized on purpose; filtering happens client-side (see the locations section below), which also keeps `setQueryData`-based tests simple.
- **Mutation hooks** live beside the query hooks and follow one of two cache strategies. Patch the cache with `setQueryData` when the endpoint returns the affected entity (`use-create-customer.ts`, `use-add-stock.ts`, `use-create-location.ts`, `use-update-location.ts`); invalidate when one write touches several lists (`use-create-invoice.ts` invalidates `['customers']`, `['invoices']`, and `['orders']`). Prefix a floating invalidate with `void` — eslint's `no-floating-promises` is on.
- **Auth is currently stubbed**: `src/lib/auth.tsx`'s `AuthProvider` hardcodes `isAuthenticated: true` — there is no real login flow or stored bearer token yet, despite the root README describing one. No request sends an `Authorization` header either, so the two sides have to be fixed together: re-enabling `require_auth` on the backend would turn today's 500s into 401s until a real login exists. `src/routes/_authenticated.tsx` guards routes via `beforeLoad` using this stubbed `context.auth`, with its redirect-to-`/login` path commented out in favor of redirecting to `/`. Don't assume a working login screen exists; check this file before building on top of auth state.
- Protected pages live under `src/routes/_authenticated/`: customers, inventory, invoices, and locations (each an `index` + `new` pair; locations also has `$locationId/edit`), plus flat `orders.tsx` and `users.tsx`. `src/routes/index.tsx` and `dashboard.tsx` are outside that guard. Each route file sets `staticData: { title }`, which is the entire breadcrumb integration — `components/breadcrumbs.tsx` reads titles off matches generically, so there's no route-segment-to-label map to update.
- **Names don't line up between the two sides**, which is the most common source of confusion:
  - frontend feature `inventory` (route `/inventory`) talks to the backend `materials` feature (`GET/POST /materials`, `POST /materials/:id/stock`)
  - backend feature `locations` reads and writes the table named `branch`
  - `routes/_authenticated/users.tsx` exists with no `users` feature or table behind it
  - the invoice form's `receivingBranch` field is serialized as `branchId`
- **Measurements are described in one place**: `features/customers/data/measurement-fields.ts` lists every measurement once — label, group, input kind (number/text/select + options) and the callout geometry that points at it on the thob sketch. Both the entry form (`components/measurement-fields.tsx`) and the read-only customer sheet (`components/customer-details-sheet.tsx`) render from that list, and `components/thob-diagram.tsx` draws the sketch itself from `data/thob-sketch.ts`. Adding a measurement means adding a `MeasurementDraft` field plus one entry here (a test asserts the two stay in step) — not touching either page.
- UI primitives: `src/components/ui/` are local shadcn/Base UI-style primitives (not a node_modules package) — extend/copy this pattern for new primitives rather than pulling in a component library.
- **Adding shadcn components**: `shadcn` is a project devDependency (not a one-off `dlx` install), configured via `components.json` (style `base-rhea`, base color `neutral`, icon library `lucide`, `rtl: true`). Add a new primitive with:

  ```bash
  cd frontend
  pnpm exec shadcn add <component>
  ```

  This writes into `src/components/ui/` using the aliases in `components.json` (`@/components`, `@/lib`, `@/hooks`, etc.) — run it from `frontend/` so paths resolve correctly, and expect it to match the existing hand-styled primitives already there rather than pulling in Radix/shadcn defaults wholesale.
- Styling: Tailwind CSS 4 via the `@tailwindcss/vite` plugin (no separate Tailwind config file to edit — see `src/styles.css` for theme tokens). Toasts are `sonner`; theming is `components/theme-provider.tsx`.

## Forms and validation

`@tanstack/react-form` with `zod` v4 — **not** react-hook-form, and no resolver package: the zod schema is handed straight to `validators: { onSubmit: schema }` via standard-schema, so validation runs on submit only. Schemas live at `features/<name>/lib/<name>-schema.ts`; cross-field rules go in `.superRefine`/`.refine` with an explicit `path`, and messages are sentence-case with a trailing period ("Enter a location name.").

Shared field wrappers are in `src/components/form/fields.tsx` (`TextField`, `NumberField`, `SelectField`) and `segmented-options.tsx` (`SegmentedOptions`, a `role="radiogroup"` of buttons — the house control for a small closed set of choices). `fields.tsx` deliberately types its form prop as `AnyFormApi = any` and its render props as `field: any`; the comment at the top of that file explains why (pinning TanStack Form's eleven validator generics collapses method signatures to `never`, and dynamic array paths break `DeepKeys<T>` inference). Follow that convention in new field components rather than trying to "fix" the types.

Every form page repeats the same submit shape, and it is load-bearing:

```tsx
const pending = mutation.mutateAsync(value)
toast.promise(pending, { loading: '...', success: (x) => `...`, error: (e) => ... })
try { await pending } catch { return }   // don't navigate away from a failed save
await navigate({ to: '/somewhere' })
```

Branch on `error.status === 409` in the `error` callback to turn a constraint violation into a readable message.

## API calls and errors

There is no fetch wrapper — hooks call `fetch` directly against `apiBaseUrl`. Query hooks throw a plain `Error` on a bad response; **mutation hooks throw `ApiError`**, which carries `status` so forms can branch on it. `ApiError` is defined in `src/features/customers/hooks/use-create-customer.ts` — an odd home, but the established one; import it from there rather than redefining it.

## Data tables and URL state

`src/hooks/use-data-table.ts` is the entry point (note: `src/hooks/`, not `src/components/data-table/`), and it syncs page, perPage, sort, and filters into the URL query string via **`nuqs`** — the adapter is wired in `routes/__root.tsx`. `src/components/data-table/` holds the presentational pieces (`DataTable`, toolbar, column header, pagination, filter controls); all five feature tables compose from there, so prefer that over bespoke table UI.

Columns drive their own filter UI through `meta`: set `label`, `placeholder`, and `variant` (`'text' | 'multiSelect' | …`, plus `options` for the select variants) and the toolbar builds the control. One gotcha — a `multiSelect` filter's value arrives at `filterFn` as a `string[]` (nuqs parses it with `parseAsArrayOf`), so the filter function must handle arrays and return `true` when the array is empty. Supporting modules: `src/config/data-table.ts` (filter operator registry), `src/types/data-table.ts`, `src/lib/data-table.ts`, `src/lib/parsers.ts`.

## Database schema notes

`backend/migrations/20260712000000_create_tables.sql` — the only migration — defines `branch`, `customers`, `materials`, `material_stock`, `invoices`, `measurements`, `orders`. All primary keys are `UUID DEFAULT uuidv7()` — time-ordered (sortable/monotonic by creation, unlike `gen_random_uuid()`'s v4), which is why Postgres 18+ is required (see above).

`measurements` is one flat row per visit (`measurement_date` plus 24 measurement columns) — repeat visits are repeat rows, which is exactly what the `json_agg (... ORDER BY m.measurement_date DESC)` aggregation below depends on. `material_stock` holds a quantity per material/location pair (`UNIQUE (material_id, branch_id)`) because a material can be stocked at more than one location.

Current backend routes, by feature module:

| Module | Routes |
| --- | --- |
| `health` | `GET /health` |
| `customers` | `GET /customers`, `POST /customers` |
| `materials` | `GET /materials`, `POST /materials`, `POST /materials/:id/stock` |
| `locations` | `GET /locations`, `POST /locations`, `PATCH /locations/:id` |
| `invoices` | `GET /invoices`, `POST /invoices` |
| `orders` | `GET /orders` |

Path params use axum 0.7's `:id` syntax (0.8 switched to `{id}` — don't copy that from newer axum docs).

**Invoice totals apply 15% VAT after the discount, floored at zero.** The rate is written twice — `VAT_RATE` in `backend/src/features/invoices/service.rs` (authoritative; the stored total) and again in `frontend/src/features/invoices/components/invoice-form/invoice-summary.tsx` (the on-screen running total). Change one and you must change the other. Note `frontend/.../lib/invoice-pricing.ts` only computes per-line totals — it has no VAT in it. Currency is single-valued by design: `CURRENCY = 'SAR'` in `src/lib/currency.ts`.

**Customer + measurements query** (`features/customers/repository.rs`): a single query does `LEFT JOIN measurements` grouped per customer, aggregating each customer's measurements with `COALESCE(json_agg(to_jsonb(m) ORDER BY m.measurement_date DESC, m.id DESC) FILTER (WHERE m.id IS NOT NULL), '[]')` — Postgres builds the nested JSON array directly, no app-side grouping. `Measurement` (`types.rs`) decodes that JSON via `#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]`: deserialize expects Postgres' raw column names (what `to_jsonb` produces), serialize emits camelCase for the frontend — one struct, two directions. `date` is the one field whose column name (`measurement_date`) doesn't match the Rust field name, so it has its own `#[serde(rename(deserialize = "measurement_date"))]` on top of the container-level rename. If you add a measurement column, no query changes are needed (`to_jsonb` picks it up automatically) — just add the matching field to `Measurement` with the same name as the column (or an explicit rename if they diverge, as with `date`).

## Locations and capability flags

A location is a `branch` row, and it carries two **independent** flags rather than one type column: `receives_orders` (customers collect finished orders there — a branch) and `holds_stock` (material stock lives there — a store). A location can be either or both; "neither" is rejected in `locations/service.rs` and in `location-schema.ts`. `is_active` retires a location without disturbing the `material_stock` rows and invoices that still reference it.

`GET /locations` deliberately returns **every** location, inactive ones included, because the Locations page lists them behind a status filter. Consumers narrow the list client-side using the two helpers in `frontend/src/features/locations/lib/location-filters.ts` — `orderReceivingLocations` (the invoice form's receiving branch) and `stockLocations` (the inventory stock-entry picker). New pickers should call those rather than reading the flags inline; that file is the single place the rules live. One deliberate exception: the inventory column facet in `inventory.tsx` stays unfiltered, since it filters materials by where stock already sits and a since-deactivated location should remain selectable there.

`PATCH /locations/:id` accepts any subset of the fields (`COALESCE` per column in the repository), so the list page's activate/deactivate action is one statement and doesn't need to round-trip the whole row.

## Tests

**Backend** — inline `#[cfg(test)] mod tests` blocks for pure logic only: invoice totals (`invoices/service.rs`), measurement comparison (`customers/types.rs`), location validation (`locations/service.rs`). `serde_json` is the only dev-dependency, so there is no DB or HTTP integration harness; the testable seam for a new feature is a pure `fn` in `service.rs`. Tests build input DTOs with `serde_json::from_value(json!({...}))`.

**Frontend** — vitest + jsdom + `@testing-library/react`, configured under `test:` in `vite.config.ts`. **There is no `@testing-library/jest-dom`**, so assertions are `.toBeTruthy()` / `.toBeNull()`, never `.toBeInTheDocument()`. Component tests seed the cache with `client.setQueryData(['key'], fixture)` rather than mocking `fetch`, and mock `@tanstack/react-router` where a component uses `useNavigate`/`Link`. Schema tests build fixtures from the production `createEmptyXForm()` factory and assert on both the message (case-insensitive regex) and the issue `path`.

## CI

Both `backend.yml` and `frontend.yml` are path-filtered (only run when their directory or the workflow file changes) and gate on: backend — `sqlx migrate run` against a real Postgres service container, then `cargo sqlx prepare --check`, `cargo fmt --check`, `cargo check --all-targets`, `cargo test --all-targets`; frontend — `pnpm run check` (prettier), `pnpm run lint`, `vitest run --passWithNoTests`, `pnpm run build`.
