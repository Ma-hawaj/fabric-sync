import { defineConfig } from 'vitest/config'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/vitest-setup.ts'],
  },
  server: {
    // Bind all interfaces so the dev server answers on the Tailscale
    // hostname too, not just localhost (allowedHosts below only permits
    // the host — it doesn't bind it).
    host: true,
    allowedHosts: ['mahawaj.cow-carat.ts.net'],
    proxy: {
      // Same-origin API in dev: `VITE_API_BASE_URL=/api` sends every
      // apiClient call here, and the rewrite strips the prefix so the
      // backend sees its bare routes (`/api/orders` -> `/orders`). Keeps
      // frontend and backend on one origin, so there are no CORS
      // preflights. Override with BACKEND_URL=... when the backend isn't
      // on :8000.
      '/api': {
        target: process.env.BACKEND_URL ?? 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Same-origin IdP in dev: `VITE_OIDC_AUTHORITY=<vite-origin>/application/o/<slug>/`
      // sends the whole OIDC dance (discovery, authorize, token, userinfo,
      // end-session) here instead of straight at Authentik's port. The path
      // is passed through untouched — Authentik serves all of its OAuth2
      // endpoints under `/application/o/`.
      //
      // `changeOrigin` stays off on purpose: Authentik builds the `iss`
      // claim and its endpoint URLs from the request's Host header, and
      // oidc-client-ts rejects tokens whose `iss` doesn't match the
      // authority. Keeping the browser's Host lets Authentik mint URLs for
      // the public origin, so discovery, issuer validation, and the auth
      // code redirect all agree on one origin. Override the target with
      // AUTHENTIK_URL=... when Authentik isn't on :9000.
      '/application/o': {
        target: process.env.AUTHENTIK_URL ?? 'http://localhost:9000',
        changeOrigin: false,
        secure: false,
      },
    },
  },
})

export default config
