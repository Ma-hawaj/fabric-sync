# Single image: Rust backend serving the built SPA plus the JSON API.
#
# Layout at runtime:
#   /app/fabric-sync   the backend binary
#   /app/static        the `vite build` output, served by the backend
#                      (see STATIC_DIR in backend/src/config.rs)
#   :8000/             the SPA (with index.html fallback for client routes)
#   :8000/api/*        the JSON API (frontend is built with VITE_API_BASE_URL=/api)
#   :8000/health       liveness probe (outside /api, unguarded)
#
# Build it:
#   docker build \
#     --build-arg VITE_OIDC_AUTHORITY=https://auth.example.com/application/o/fabric-sync/ \
#     --build-arg VITE_OIDC_CLIENT_ID=<spa-client-id> \
#     -t fabric-sync .
#
# Run it (needs Postgres + the OIDC provider reachable):
#   docker run -p 8000:8000 --env-file .env -e DATABASE_URL=... fabric-sync
#
# Notes:
# - Vite bakes VITE_* vars in at build time, so OIDC settings are --build-arg,
#   while everything the backend reads (DATABASE_URL, OAUTH_*, ...) stays
#   runtime env. Rebuild the image to change the former; just restart to change
#   the latter.
# - Migrations run automatically at startup (sqlx::migrate! in main.rs).

# ---------- frontend build ----------
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend

# Build-time config baked into the bundle. VITE_API_BASE_URL stays /api: in
# this image frontend and backend share one origin, so no proxy or CORS.
ARG VITE_API_BASE_URL=/api
ARG VITE_OIDC_AUTHORITY=""
ARG VITE_OIDC_CLIENT_ID=""
ARG VITE_OIDC_REDIRECT_URI=""
ARG VITE_OIDC_POST_LOGOUT_REDIRECT_URI=""
ARG VITE_OIDC_SCOPE="openid profile email"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI \
    VITE_OIDC_POST_LOGOUT_REDIRECT_URI=$VITE_OIDC_POST_LOGOUT_REDIRECT_URI \
    VITE_OIDC_SCOPE=$VITE_OIDC_SCOPE

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

# ---------- backend build ----------
FROM rust:1-bookworm AS backend
WORKDIR /src
ENV SQLX_OFFLINE=true

# The printed-invoice catalog is embedded from the frontend tree
# (include_bytes! in backend/src/features/invoices/designs.rs), so the
# design assets must exist at this relative path at compile time.
COPY --from=frontend /app/frontend/public/designs ./frontend/public/designs
COPY backend/Cargo.toml backend/Cargo.lock ./backend/
COPY backend/migrations ./backend/migrations
COPY backend/.sqlx ./backend/.sqlx
COPY backend/src ./backend/src
COPY backend/templates ./backend/templates
COPY backend/seeds ./backend/seeds
RUN cargo build --release --manifest-path backend/Cargo.toml

# ---------- runtime ----------
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/
COPY --from=backend /src/backend/target/release/fabric_sync /app/fabric-sync
COPY --from=frontend /app/frontend/dist /app/static

ENV PORT=8000 \
    STATIC_DIR=/app/static
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8000/health | grep -q '"status":"ok"'
CMD ["/app/fabric-sync"]
