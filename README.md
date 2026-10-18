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

Migrating from the Authentik stack needs a fresh volume (`docker compose down && docker volume rm fabric-sync_postgres-data`).

After the stack is up, create two OAuth applications in the Zitadel console, in the same project:

- **Backend introspection client** — confidential (has a client secret). Copy its client ID/secret into `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` for the backend.
- **Frontend SPA client** — public, PKCE, no client secret. Set its redirect URI and post-logout redirect URI to `http://localhost:3000/` (must match `VITE_OIDC_REDIRECT_URI`/`VITE_OIDC_POST_LOGOUT_REDIRECT_URI`), and copy its client ID into `VITE_OIDC_CLIENT_ID` for the frontend.

If a valid access token gets a 401 from the backend unexpectedly, check the `aud` claim Zitadel puts on tokens issued to the SPA client against whatever `OAUTH_RESOURCE_AUDIENCE` is set to — either add the backend's client ID as an audience in Zitadel, or leave `OAUTH_RESOURCE_AUDIENCE` unset locally.

`GET /users` (the order-stage assignee picker) is backed by Zitadel's user directory: create a machine user (Users > New > Machine user, e.g. `fabric-sync-backend`), add a client secret into `ZITADEL_USERS_CLIENT_SECRET` (with its ID in `ZITADEL_USERS_CLIENT_ID`), and grant it the "Org User Manager" (`ORG_USER_MANAGER`) role under Organization > Managers (see `backend/.env.example`). For the Roles column, also grant it user-grant read — without that, roles come back empty and the backend logs a warning.

## Backend

Invoice creation and editing offer a WhatsApp preview before sending. Orders
have an explicit **Ready for pickup** confirmation, with invoice readiness
calculated from the remaining uncollected orders. All invoice customers are
selected by default and destinations are deduplicated by normalized mobile.
Invoice PDF exports and notification attachments share stored, server-rendered
Chromium PDFs. See [notification setup and verification](docs/whatsapp-notifications.md)
for sender templates, renderer configuration, delivery history, and retries.

Staff can cancel orders and record returns with their refunds in one action. See
[Cancellations, returns and refunds](docs/returns-and-refunds.md) for the workflow, refund
limits, stock behavior, and API examples.

The backend reads configuration from environment variables (`backend/.env`
via `dotenvy` when running locally — copy `backend/.env.example` there
first).

Common variables:

- `PORT`, default `3000` (the local setup below runs the backend on `8000` to stay clear of Vite on `:3000`)
- `DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/fabric_sync`
- `OAUTH_ISSUER_URL` or `OIDC_ISSUER_URL`
- `OAUTH_CLIENT_ID` or `OIDC_CLIENT_ID`
- `OAUTH_CLIENT_SECRET` or `OIDC_CLIENT_SECRET`
- `OAUTH_INTROSPECTION_URL`
- `OAUTH_RESOURCE_AUDIENCE`
- `ZITADEL_USERS_CLIENT_ID`
- `ZITADEL_USERS_CLIENT_SECRET`

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

- `VITE_OIDC_AUTHORITY` — issuer URL (`http://localhost:8080` for local Zitadel)
- `VITE_OIDC_CLIENT_ID` — the frontend SPA client's ID (see "Local Infrastructure" above)
- `VITE_OIDC_REDIRECT_URI` / `VITE_OIDC_POST_LOGOUT_REDIRECT_URI`, default `http://localhost:3000/`
- `VITE_OIDC_SCOPE`, default `openid profile email`

API calls are same-origin in dev: `VITE_API_BASE_URL=/api` sends them through the Vite dev-server proxy (`/api` → the backend as-is, since the backend serves the API nested under `/api` — see `BACKEND_URL` in `frontend/vite.config.ts`), so frontend and backend share one URL with no CORS involved. The IdP is hit directly. To bypass the proxy and hit the backend directly instead:

```bash
cd frontend
VITE_API_BASE_URL=http://localhost:8000 pnpm run dev
```

## Garment pricing

Urgency is selected separately for each tailoring order. The server applies a
VAT-inclusive urgent charge after invoice discounts, and the form displays it
read-only. Set `URGENT_ORDER_CHARGE` to a positive amount and
`URGENT_ORDER_CHARGE_UNIT` to `amount` (fixed BHD per urgent order) or `percent`
(percentage of that order's calculated garment price). No rate is assumed:
urgent orders cannot be saved until pricing is configured. Regular orders have
no urgent charge. An invoice containing any urgent order requires a target date.

Materials have junior, normal, and large garment prices, entered when creating
a material or through its Edit Material dialog. Design options have an optional
additional cost (zero by default). Prices include VAT.

Quantity in metres selects the garment price; it does not multiply it. The shared
range constants are `JUNIOR_BELOW_METRES` and `LARGE_ABOVE_METRES` in
`frontend/src/features/invoices/lib/garment-pricing.ts`, mirrored by `JUNIOR_BELOW`
and `LARGE_ABOVE` in `backend/src/features/pricing/service.rs`. Change both pairs
together; a test checks that they agree. Defaults are junior below 3 m, normal
3–4 m inclusive, and large above 4 m.

The server calculates final prices from the catalog plus selected design costs.
Customer-supplied fabric uses the fixed VAT-inclusive tailoring base configured
by `CUSTOMER_MATERIAL_BASE_PRICE`, plus design costs. This is one price per order,
independent of metres used. The form displays the price read-only; client-supplied
price overrides are ignored. No amount is assumed, so customer-material orders
cannot be saved until the fixed price is configured. Editing an invoice
recalculates prices using the current pricing configuration and catalog; viewing
or printing keeps the saved prices. Imported materials without tier prices must
be configured before creating garment lines.

Each material’s Actions menu includes Add Stock with that material already selected,
so only locations and quantities need entering.
Add Stock also opens a dialog from the inventory page, supporting existing materials,
new materials with tier prices, and stock at multiple locations.

Material details are read-only. Use the inventory row actions to edit a material
(name, SKU, family, unit, and tier prices), remove stock, or move stock. Move Stock
transfers a quantity from one location to another in one transaction; it refuses
insufficient source stock and inactive or non-stock-holding destinations. Moves
keep total material stock unchanged and can create a destination stock row.
