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

`cargo sqlx prepare --check` runs in CI and fails if `backend/.sqlx` is stale — regenerate it any time a query changes, not just when tests fail. The cache covers the writes and the by-code lookup; the list queries are built at runtime by `src/list/` and are deliberately absent from it.

Sample data for local work lives in `backend/seeds/dev_seed.sql` and is loaded at startup by `SEED_DEV_DATA=true cargo run` (locations, materials, products, customers with repeat measurement visits, invoices across every payment state, gift cards, and twelve orders spread across the tracking checklist with four repairs and a few stage assignments). It only runs against a database with no customers yet — `seed::run` guards on that, so repeated runs are safe and it can never touch real rows. The script is executed with `sqlx::raw_sql`, **not** the `query!` macros, deliberately: `raw_sql` is unchecked, so the seed contributes nothing to `backend/.sqlx` and can't break `cargo sqlx prepare --check`. The backend reads the flag off the process env — there is no `dotenvy`, so `.env` is for docker compose only.

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
- **Auth**: `auth.rs` implements OAuth2/OIDC token introspection (`TokenIntrospection::discover` does OIDC discovery or uses `OAUTH_INTROSPECTION_URL` directly; `require_auth` is an axum middleware that validates the bearer token and inserts `AuthenticatedUser` as a request extension). `require_auth` is wired into `app.rs` via `.route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth))` on every domain feature router (`customers`, `materials`, `locations`, `invoices`, `orders`, `products`, `gift_cards`, `order_stages`, `users`) — only `health` is unguarded. Adding a new feature router means adding this same `.route_layer(...)` call, not inventing a new mechanism. A missing/invalid bearer token returns 401 via `AppError::Unauthorized`, not a bare status code.
- **List endpoints share one layer** (`backend/src/list/`): a feature declares a `ListSpec` — its `SELECT`, the public field names that may be filtered or sorted, and a tie-breaker order — and calls `list::fetch_page`. Don't write paging or filtering per endpoint. The builder wraps the feature's query as a CTE and applies `WHERE`/`ORDER BY`/`LIMIT` to its _output_ columns, which is why the `json_agg` + `GROUP BY` shapes and the invoice list's lateral aggregates need no rewriting; each base query yields one row per entity, so `LIMIT` counts entities, and `count(*) OVER ()` carries the filtered total. `list::fetch_by_id` reuses the same `ListSpec`, so a base query is written once.
  - A column a table shows but the database doesn't store (an invoice's customer names, a material's stock total, a location's `uses`, an order's balance due, an order's current production `stage`) has to be **computed in the base query** to be filterable or sortable — the browser can no longer derive it, because it only holds one page. Orders' `current_stage` is the deepest case: its SQL mirrors `stage_applies`/`assemble_stages`/`current_stage_name` in `orders/service.rs` (see the order-tracking section below) so the Stage filter can run in the database — two independent implementations of the same rule that have to be kept in sync by hand.
  - Rows decode via `#[derive(sqlx::FromRow)]` on the existing DTO (or, for `orders`, on the intermediate `OrderRow` — see below), with `#[sqlx(json)]` on the aggregated JSON fields. Extra output columns that exist only to be filtered on are ignored by `FromRow`.
  - The query-string contract mirrors the frontend's filter DSL exactly (`page`, `perPage`, `sort=[{id,desc}]`, `filters=[{id,value,variant,operator}]`, `joinOperator`); the enums in `list/params.rs` are the spec. **Omitting `perPage` returns every row** — that is what keeps the form pickers working — and an explicit `perPage` is clamped to `MAX_PER_PAGE`.
  - Client strings never reach SQL as identifiers: a field name is looked up in the `ListSpec` and resolved to a fixed expression, operators map to fixed fragments, and values always become bind parameters. Keep it that way when adding an operator.
  - These queries are **runtime-built**, so they are not in the `.sqlx` cache and get no compile-time checking. `list/sql.rs`'s tests assert the generated SQL text and bind order instead; add a case there when you add an operator.
  - `orders/service.rs::list_orders` paginates before enriching: `repository::list_orders` returns a `Page<OrderRow>` via the shared layer, then `assemble()` runs the checklist/repair queries over just that page's rows — not the whole table — before the result is re-wrapped as `Page<OrderListItem>`. Follow this pattern for any future list that needs a Rust-side enrichment pass on top of the SQL page.
- **Errors**: all fallible backend code returns `Result<_, AppError>` (`error.rs`), a single enum with one `IntoResponse` impl. Variants: `Auth` (500, boot-time OIDC-discovery failure only), `Unauthorized` (401, per-request auth failures from `require_auth`), `Io`, `Sqlx`, `Migration` (all 500), `NotFound` (404), `Conflict` (409), `BadRequest` (400). Add new variants there rather than converting to strings/status codes ad hoc in handlers.
- **Postgres error codes map to HTTP automatically** in `From<sqlx::Error>`: SQLSTATE `23505` (unique_violation) becomes a 409 `Conflict`, `23503` (foreign_key_violation) becomes a 400 `BadRequest`. Leaning on a database constraint therefore gives you the right status for free — `branch.name`'s `UNIQUE` is what makes a duplicate location name a 409 rather than a 500, with no handler code involved.
- Config (`config.rs`) is read once from env vars at startup into a plain struct (`Config::from_env()`); there's no config file or hot-reload — add new settings as additional env-var-backed fields.

## Frontend architecture

- **Feature-module layout** mirrors the backend: `src/features/<name>/` contains `<name>.tsx` (list page), `components/`, `hooks/`, `types/`, and — where the feature needs them — `lib/` (zod schemas, pricing helpers) and `data/` (static option lists). Form pages sit at the feature root next to the list page (`customer-form.tsx`, `invoice-form.tsx`, `inventory-form.tsx`, `location-form.tsx`). Routes in `src/routes` are thin — they wire a route path to a feature page component.
- **Data fetching is real, not mocked**, via `axios`. `src/lib/api.ts` exports `apiClient` (an `axios.create({ baseURL: apiBaseUrl })` instance) and `ApiError`; every hook under `src/features/*/hooks/` calls `apiClient.get/post/patch` against a path (no `apiBaseUrl` string-templating in hook bodies) — there are no hardcoded arrays or artificial delays left anywhere. A request interceptor attaches `Authorization: Bearer <token>` (via `getAccessToken()` in `src/lib/oidc.ts`) to every call; a response interceptor normalizes every HTTP-level failure to `ApiError` (carrying `.status`), so hooks don't write their own try/catch just to get a status to branch on. The one exception is `use-gift-card-by-code.ts`, which still catches to turn a 404 into a `null` result (a miss is a valid answer there, not an error).
- **TanStack Query setup**: a single `QueryClient` is created once in `main.tsx` and passed both to `QueryClientProvider` (for component-level `useQuery`/`useMutation`) and into the router's context (`router.tsx`/`main.tsx`'s `<App>`) so route `loader`s can also use it (e.g. `context.queryClient.ensureQueryData(...)`). There's no central query-key or query-options registry — each feature hook defines its own `queryKey`/`queryFn`/`staleTime` inline and is the unit other components import (e.g. `customers.tsx` calls `useCustomers()`); follow that per-feature-hook pattern for new data, and keep `staleTime` explicit (every existing hook uses 5 minutes) rather than relying on the default.
- **Paging, filtering and sorting happen on the server**, through one shared layer per side — don't hand-roll either half for a new list. On the frontend that is `src/lib/list-params.ts` (URL keys, and the translation from table filter state into the API's filter DSL), `src/hooks/use-list-params.ts` (reads the URL, returns the request) and `src/hooks/use-list-query.ts` (issues it, through `apiClient` — see data fetching below). A feature's list hook is a call to `useListQuery` with an endpoint and a key; see `features/invoices/hooks/use-invoices.ts`. The backend half is `backend/src/list/` — see the backend section.
- **Query keys are `[name, serializedRequest]`**: `['invoices', 'page=1&perPage=10']`. The second segment is the serialized page/sort/filter state, so each combination caches separately, and prefix matching on `['invoices']` still invalidates them all. `''` is the unpaginated request — the key the `useAllX` hooks use.
- **Two hooks per resource where forms need one.** The paginated hook takes `searchParams` and backs a table; the `useAllX` companion sends no `perPage`, which tells the API to return everything, and backs a form picker (`useAllCustomers`, `useAllLocations`, `useAllProducts`, `useAllInventory`, `useAllOrderStages`, and invoices' `useMaterials`). Reach for the `All` variant only for a picker that genuinely needs every row. This is also what separates the two `Material` types that used to share one `['materials']` cache entry.
- **Mutation hooks** live beside the query hooks and **invalidate**; they never `setQueryData`. There is no single list to patch any more — the cache holds one envelope per page-and-filter combination — so `invalidateQueries({ queryKey: ['customers'] })` is the only correct move. Prefix a floating invalidate with `void` — eslint's `no-floating-promises` is on.
- **Auth is real OIDC** (Authorization Code + PKCE via `react-oidc-context`/`oidc-client-ts`, generic/OIDC-standard — Zitadel locally, but not hardcoded to it). `src/lib/oidc.ts` holds the `UserManager` (config from `VITE_OIDC_*` env vars, token in `sessionStorage`) and `getAccessToken()`. `src/lib/auth.tsx`'s `AuthProvider` wraps `react-oidc-context`'s provider and adapts its state to the app's `AuthState` shape (`isAuthenticated`, `isLoading`, `user`, `signIn`, `signOut`); `useAuth()` is unchanged as the consumption point. `src/routes/_authenticated.tsx` guards routes via `beforeLoad`, calling `context.auth.signIn(location.href)` to redirect straight to the IdP's hosted login when unauthenticated — there is no local `/login` page (auto-redirect UX). `main.tsx` gates mounting `RouterProvider` on `auth.isLoading` so the redirect check never fires before `react-oidc-context` finishes resolving the session on boot.
- Protected pages live under `src/routes/_authenticated/`: customers, inventory, invoices, locations, and order-stages (each an `index` + `new` pair; locations also has `$locationId/edit`, order-stages also has `$stageId/edit`), plus flat `orders.tsx`, `users.tsx`, and `dashboard.tsx`. Only `src/routes/index.tsx` is outside that guard. Each route file sets `staticData: { title }`, which is the entire breadcrumb integration — `components/breadcrumbs.tsx` reads titles off matches generically, so there's no route-segment-to-label map to update.
- **Names don't line up between the two sides**, which is the most common source of confusion:
  - frontend feature `inventory` (route `/inventory`) talks to the backend `materials` feature (`GET/POST /materials`, `POST /materials/:id/stock`)
  - backend feature `locations` reads and writes the table named `branch`
  - `routes/_authenticated/users.tsx` exists but isn't wired to the backend `users` feature below it
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

Hooks call `apiClient` (an axios instance, `src/lib/api.ts`) rather than `fetch` — `apiClient.get<T>('/path')` / `.post<T>('/path', body)` / `.patch<T>('/path', body)`, reading the response via `.data`. Both the bearer-token attachment and error normalization happen once, centrally, via axios interceptors on `apiClient` — hooks don't write their own auth headers or `try`/`catch`. Any non-2xx response comes out of `apiClient` as `ApiError` (also defined in `src/lib/api.ts`, carrying `.status`) so forms can branch on it (e.g. `error instanceof ApiError && error.status === 409`) with no per-hook error-handling code. The one hook that still needs its own `try`/`catch` is `use-gift-card-by-code.ts`, which catches `ApiError` to turn a 404 into a `null` result — a miss is a valid answer there, not an error.

## Data tables and URL state

`src/hooks/use-data-table.ts` is the entry point (note: `src/hooks/`, not `src/components/data-table/`), and it syncs page, perPage, sort, and filters into the URL query string via **`nuqs`** — the adapter is wired in `routes/__root.tsx`. `src/components/data-table/` holds the presentational pieces (`DataTable`, toolbar, column header, pagination, filter controls); all seven feature tables compose from there, so prefer that over bespoke table UI.

Its `manualPagination`/`manualSorting`/`manualFiltering` options all default to **`true`** — the server does the work — so a page passes `pageCount` and `rowCount` from the query and otherwise leaves them alone. A page reads its URL state with `useListParams` **before** fetching (the query has to be issued before there is data to build a table from), and both hooks read the same nuqs keys, defined once in `lib/list-params.ts`. Note the URL keeps one key per filterable column (`?name=ali&status=paid,unpaid`) while the _request_ carries the DSL; `toFilterDsl` is the single point of translation.

Columns drive their own filter UI through `meta`: set `label`, `placeholder`, and `variant` (`'text' | 'multiSelect' | …`, plus `options` for the select variants) and the toolbar builds the control. The `variant` now does double duty — it also picks the operator sent to the API (`text` contains, `multiSelect` matches any of, `range`/`dateRange` compare between), so a column with no `variant` cannot be filtered at all. Columns carry **no `filterFn`**: nothing client-side filters any more.

Two things that follow from the server doing the work: an option list must be _declared_, not derived from the rows on screen (those are one page — `invoices.tsx` and `orders.tsx` source theirs from their own queries), and an option's `value` is the token the API matches on while its `label` is what staff read (`location-columns.tsx`, `product-columns.tsx` and `gift-card-columns.tsx` all rely on that split). Supporting modules: `src/config/data-table.ts` (filter operator registry), `src/types/data-table.ts`, `src/lib/data-table.ts`, `src/lib/parsers.ts`.

## Database schema notes

`backend/migrations/20260712000000_create_tables.sql` — the only migration — defines `branch`, `customers`, `materials`, `material_stock`, `invoices`, `measurements`, `orders`, `order_stages`, `order_repairs`, `order_stage_progress`. All primary keys are `UUID DEFAULT uuidv7()` — time-ordered (sortable/monotonic by creation, unlike `gen_random_uuid()`'s v4), which is why Postgres 18+ is required (see above).

`measurements` is one flat row per visit (`measurement_date` plus 24 measurement columns) — repeat visits are repeat rows, which is exactly what the `json_agg (... ORDER BY m.measurement_date DESC)` aggregation below depends on. `material_stock` holds a quantity per material/location pair (`UNIQUE (material_id, branch_id)`) because a material can be stocked at more than one location.

## Order tracking and repairs

Production progress is **derived, never stored per order**. Four tables carry it:

- `order_stages` — the staff-editable catalog (`name UNIQUE`, `sort_order`, `requires_delivery`, `is_active`), seeded in the migration with Cutting / Sewing / Finishing / Location delivery. It's a table rather than more values on `orders.status` precisely so staff can change it, and it retires with `is_active` like `branch` rather than deleting.
- `order_repairs` — a garment brought back for rework. An order can have several; each is `open → in_progress → completed | cancelled` with an optional `charge` (recorded for the books, never billed to an invoice).
- `order_stage_progress` — only the stages actually acted on (`done` or `skipped`), one checklist per order (`UNIQUE (order_id, stage_id)`). A repair does **not** get its own pass through these stages — it's tracked by `order_repairs.status` alone (`open → in_progress → completed | cancelled`, moved by staff via `PATCH .../repairs/:repairId`, not by acting on a checklist).
- `order_stage_assignments` — who's assigned to a stage, deliberately **separate** from `order_stage_progress` (`UNIQUE (order_id, stage_id)`, no status column at all). A stage is assignable before it's ever touched, so this can't live on a row that only exists once a stage is done or skipped — assignment and progress are independent, and a stage can be assigned, reassigned, or cleared regardless of where it is in the checklist. `assignee_id`/`assignee_name` are plain `TEXT`, not a foreign key — see the `users` note below.

A checklist is built by overlaying the progress rows onto the live catalog, so **adding or retiring a stage takes effect on in-flight orders with no backfill**, and invoice creation seeds nothing (`insert_order` is unchanged). A retired stage stays on an order that already recorded it. Undoing a stage **deletes** its row — absence _is_ "not done yet", which is why there is no stored `pending`.

`orders.production_branch_id` is where the garment is made; the invoice's `branch_id` is where the customer collects. A `requires_delivery` stage is reported `applicable: false` when the two match or either is unknown, so it never blocks an order that never had to move.

**Production location is inferred when it isn't set.** An explicit `orders.production_branch_id` (set via `PATCH /orders/:id`) always wins. Absent one, `orders/service.rs::effective_production` looks at `material_stock` for the order's material: if it's stocked at exactly one active, stock-holding location with `quantity > 0`, that location is used and the response carries `productionLocationInferred: true`; a material split across several locations (or with none) is left `null` for staff to assign, since there's nothing to disambiguate it with. `orders/repository.rs::single_stock_locations` does the underlying query (`GROUP BY material_id HAVING COUNT(DISTINCT branch_id) = 1`), batched once per `GET /orders` call. The inferred value feeds `stage_applies` exactly like an explicit one, so a delivery stage can become required with no staff action at all.

**Stage timing is derived, not stored.** `OrderStageEntry.startedAt` has no backing column — `orders/service.rs::with_start_times` chains each stage's start to the previous stage's `completedAt` (a non-applicable stage is transparent to the chain: no start time, and it doesn't block the next one from getting one). The very first stage's start is midnight UTC on `invoice_date` — the closest thing to a creation timestamp the schema has, since `orders` has no `created_at`. Only a recorded stage or the current outstanding one gets a start time; anything further down the queue is `null` since work hasn't reached it.

**A stage is assignable independent of its status.** `PUT /orders/:id/stages/:stageId/assignee` (body `{ assigneeId }`, omitted or `null` clears it) upserts `order_stage_assignments`; `orders/service.rs::set_assignee` resolves `assigneeId` against `users::service::list_users` server-side and stores the resolved name, rather than trusting a display name from the client. `orders/service.rs::with_assignees` overlays the result onto an already-assembled checklist — it's a separate pass from `assemble_stages`/`with_start_times`, since assignment has nothing to do with progress.

The assembly lives in pure functions in `orders/service.rs` (`stage_applies`, `assemble_stages`, `current_stage_name`, `effective_production`, `with_start_times`, `with_assignees`) fed by flat queries rather than one lateral join — that is the only seam the backend's test setup can exercise. **`orders.status` and invoice settlement are untouched by all of this**: `receive_order` still works with stages outstanding, and `invoice_fully_received` still counts `status <> 'received'`.

Frontend display rules live in one place, `features/orders/lib/order-tracking.ts` (`currentStageLabel`, `stageFilterOptions`, `openRepairCount`, `stageTimingLabel`, …) — the Stage/Repairs columns and the tracking sheet both read from it. The catalog is administered at `/order-stages`, a file-for-file mirror of the `locations` feature. The assignee picker in the tracking sheet (`components/order-tracking-sheet.tsx`) is fed by `features/users/hooks/use-users.ts`, a plain `GET /users` query — unrelated to `routes/_authenticated/users.tsx`, which is still its own unwired stub.

Current backend routes, by feature module:

| Module         | Routes                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health`       | `GET /health`                                                                                                                                                                                                     |
| `customers`    | `GET /customers`, `POST /customers`                                                                                                                                                                               |
| `materials`    | `GET /materials`, `POST /materials`, `POST /materials/:id/stock`                                                                                                                                                  |
| `locations`    | `GET /locations`, `POST /locations`, `PATCH /locations/:id`                                                                                                                                                       |
| `invoices`     | `GET /invoices`, `POST /invoices`, `GET /invoices/:id`, `GET /invoices/:id/document`, `POST /invoices/:id/receive`                                                                                                |
| `orders`       | `GET /orders`, `PATCH /orders/:id`, `POST /orders/:id/receive`, `POST /orders/:id/stages/:stageId`, `PUT /orders/:id/stages/:stageId/assignee`, `POST /orders/:id/repairs`, `PATCH /orders/:id/repairs/:repairId` |
| `order_stages` | `GET /order-stages`, `POST /order-stages`, `PATCH /order-stages/:id`                                                                                                                                              |
| `products`     | `GET /products`, `POST /products`, `PATCH /products/:id`, `POST /products/:id/stock`                                                                                                                              |
| `gift_cards`   | `GET /gift-cards`, `POST /gift-cards`, `PATCH /gift-cards/:id`, `GET /gift-cards/by-code/:code`                                                                                                                   |
| `users`        | `GET /users`                                                                                                                                                                                                      |

Every `GET` list route above is served by the shared list layer and returns `{data, page, perPage, total, pageCount}` — never a bare array — with one exception: `GET /users` is a hardcoded mock (see below) with no database or `ListSpec` behind it.

Path params use axum 0.7's `:id` syntax (0.8 switched to `{id}` — don't copy that from newer axum docs).

**`users` is mocked.** `features/users/service.rs::list_users` returns four hardcoded `User { id, name }` values — there's no table, no `repository.rs`, and the handler's `AppState` parameter is currently unused. The plan is to back it with Zitadel's user directory once real auth is wired up (`require_auth` is disabled — see above); `id` is a plain `String` rather than a `Uuid` because it's meant to eventually hold a Zitadel subject, not an id this app generates. It's `pub(crate)` (see `users/mod.rs`) so `orders/service.rs::set_assignee` can resolve an assignee's display name against it directly — the same cross-feature-call pattern `invoices` already uses against `customers`/`products`.

**Invoice totals apply 10% VAT after the discount, floored at zero.** The rate is written twice — `VAT_RATE` in `backend/src/features/invoices/service.rs` (authoritative; the stored total) and again in `frontend/src/features/invoices/components/invoice-form/invoice-summary.tsx` (the on-screen running total). Change one and you must change the other. Note `frontend/.../lib/invoice-pricing.ts` only computes per-line totals — it has no VAT in it. Currency is single-valued by design: `CURRENCY = 'BHD'` in `src/lib/currency.ts`, and `CURRENCY`/`CURRENCY_DECIMALS` in `invoices/document.rs` for the printed document (BHD is a three-decimal currency, so amounts print as fils even though they are stored `NUMERIC(10, 2)`).

`service::breakdown` is the single place the arithmetic between the line items and the total lives, shared by `compute_totals` on the create path and `get_invoice` on the read path. The `invoices` table stores only `total_price`, `discount` and `discount_unit` — never the VAT — so anything that has to _show_ VAT rebuilds it from the lines; going through one function is what stops the printed figures and the stored total from drifting. Each component is rounded before the total is summed, so the numbers add up when read down the page.

**Customer + measurements query** (`features/customers/repository.rs`): a single query does `LEFT JOIN measurements` grouped per customer, aggregating each customer's measurements with `COALESCE(json_agg(to_jsonb(m) ORDER BY m.measurement_date DESC, m.id DESC) FILTER (WHERE m.id IS NOT NULL), '[]')` — Postgres builds the nested JSON array directly, no app-side grouping. `Measurement` (`types.rs`) decodes that JSON via `#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]`: deserialize expects Postgres' raw column names (what `to_jsonb` produces), serialize emits camelCase for the frontend — one struct, two directions. `date` is the one field whose column name (`measurement_date`) doesn't match the Rust field name, so it has its own `#[serde(rename(deserialize = "measurement_date"))]` on top of the container-level rename. If you add a measurement column, no query changes are needed (`to_jsonb` picks it up automatically) — just add the matching field to `Measurement` with the same name as the column (or an explicit rename if they diverge, as with `date`).

## The printed invoice

`GET /invoices/:id/document` renders an invoice as a **self-contained bilingual HTML page** (RTL, Arabic + English, A4, with a TLV QR code). It is deliberately HTML and not a PDF: Arabic needs a real text shaper, which the pure-Rust PDF crates and `@react-pdf/renderer` don't have and a browser already is — so whatever displays the page prints it. Today that is the user's browser; the same markup can later be handed to headless Chromium to email invoices unattended, with no template rewrite. That is also why it renders **server-side rather than in the frontend**: a React print view can't be rendered without a logged-in browser.

- **`backend/templates/invoice.html` is the file to edit to restyle it** — minijinja, with the available context documented in a comment at the top. It is `include_str!`-embedded by default; set `INVOICE_TEMPLATE_DIR` to load from disk instead, and design changes need no rebuild.
- Keep it self-contained: inline `<style>`, inline SVG, `data:` URIs. It is printed from an iframe with no origin of its own, and a future PDF renderer may have no network.
- Money is pre-formatted in `document.rs` and handed to the template as the `amounts` map, so editing the design can't change how amounts are written. Template logic stays presentational — the customer dedup, the QR, and every number are computed in Rust.
- Company identity comes from `COMPANY_*` env vars (`config.rs`'s `InvoiceBranding`), never from the template.
- The QR payload is a base64 TLV of five fields (seller, VAT number, timestamp, total, VAT). The length byte is a **byte** count, which is what makes an Arabic seller name easy to get wrong. **Not validated against any tax authority's certification suite** — verify before relying on it for filings.
- `invoices.invoice_number` (identity) and `created_at` exist for this: a tax invoice needs a human-readable number and an issue time, and the uuidv7 key and bare `invoice_date` gave neither.

On the frontend, `features/invoices/lib/print-invoice.ts` fetches that HTML and writes it into a hidden iframe via `srcdoc`, then prints the frame. Two reasons it isn't a `<iframe src>` or a print route: the app shell (`__root.tsx` wraps _every_ route in the sidebar) never reaches the print output, and an ordinary `fetch` can carry an `Authorization` header once one exists. Reached from three places — the invoices table row action, the details sheet, and the invoice form's `Save & Export PDF`.

## Locations and capability flags

A location is a `branch` row, and it carries two **independent** flags rather than one type column: `receives_orders` (customers collect finished orders there — a branch) and `holds_stock` (material stock lives there — a store). A location can be either or both; "neither" is rejected in `locations/service.rs` and in `location-schema.ts`. `is_active` retires a location without disturbing the `material_stock` rows and invoices that still reference it.

`GET /locations` deliberately returns **every** location, inactive ones included, because the Locations page lists them behind a status filter (and, like every list endpoint, it returns every row only when the caller omits `perPage`). Consumers narrow the list using the helpers in `frontend/src/features/locations/lib/location-filters.ts` — `orderReceivingLocations` (the invoice form's receiving branch, and a delivery stage's destination), `stockLocations` (the inventory stock-entry picker), and `productionLocations` (an order's "made at" picker, currently an alias of the stock rule since production happens where the material is — named separately so a dedicated capability flag would only change that one function). New pickers should call those rather than reading the flags inline; that file is the single place the rules live. One deliberate exception: the inventory column facet in `inventory.tsx` stays unfiltered, since it filters materials by where stock already sits and a since-deactivated location should remain selectable there.

`PATCH /locations/:id` accepts any subset of the fields (`COALESCE` per column in the repository), so the list page's activate/deactivate action is one statement and doesn't need to round-trip the whole row.

## Tests

**Backend** — inline `#[cfg(test)] mod tests` blocks for pure logic only: invoice totals (`invoices/service.rs`), measurement comparison (`customers/types.rs`), location validation (`locations/service.rs`), stage-name/position validation (`order_stages/service.rs`), and the tracking derivation (`orders/service.rs` — delivery applicability, checklist assembly, current stage, repair validation, production-location inference, stage timing). `serde_json` is the only dev-dependency, so there is no DB or HTTP integration harness; the testable seam for a new feature is a pure `fn` in `service.rs`. Tests build input DTOs with `serde_json::from_value(json!({...}))`.

**Frontend** — vitest + jsdom + `@testing-library/react`, configured under `test:` in `vite.config.ts`. **There is no `@testing-library/jest-dom`**, so assertions are `.toBeTruthy()` / `.toBeNull()`, never `.toBeInTheDocument()`. Component tests seed the cache rather than mocking `fetch` — with `client.setQueryData(allRowsKey('materials'), listResponse(fixture))`, since list hooks cache an envelope under a `[name, request]` key; both helpers are in `src/lib/list-fixtures.ts`. They also and mock `@tanstack/react-router` where a component uses `useNavigate`/`Link`. Schema tests build fixtures from the production `createEmptyXForm()` factory and assert on both the message (case-insensitive regex) and the issue `path`.

## CI

Both `backend.yml` and `frontend.yml` are path-filtered (only run when their directory or the workflow file changes) and gate on: backend — `sqlx migrate run` against a real Postgres service container, then `cargo sqlx prepare --check`, `cargo fmt --check`, `cargo check --all-targets`, `cargo test --all-targets`; frontend — `pnpm run check` (prettier), `pnpm run lint`, `vitest run --passWithNoTests`, `pnpm run build`.
