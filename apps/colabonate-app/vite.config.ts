import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { createRequire } from 'node:module'

const root = path.resolve(__dirname, '../..')
const appDir = __dirname
const require = createRequire(import.meta.url)
const { version: appVersion } = require('./package.json')

export default defineConfig({
  // Absolute base for web (deep-link loads like /admin need /assets/...).
  // Capacitor (androidScheme: 'https') also resolves absolute paths correctly.
  // Override with VITE_BASE_PATH='./' only for a file://-served bundle.
  base: process.env.VITE_BASE_PATH || '/',
  // SPA mode — Vite serves index.html for unmatched routes so React-Router
  // can take over (deep-links like /ai, /admin, /wallet must not 404).
  appType: 'spa',
  plugins: [
    react(),
    tailwindcss(),
    {
      // Belt-and-braces SPA history fallback: rewrite HTML-navigation requests
      // for deep-links (e.g. /ai, /admin, /wallet) to /index.html so React-
      // Router can mount. `enforce: 'pre'` makes this run BEFORE Vite's
      // built-in proxy middleware so /ai/chat (the only AI API endpoint) is
      // still proxied to the AI backend by Vite after we've handled HTML
      // navigation for plain /ai.
      name: 'spa-history-fallback',
      enforce: 'pre',
      apply: 'serve',
      configureServer(server) {
        // Return a middleware with an arity-3 fn so Vite knows it's async-friendly.
        return () => {
          server.middlewares.use((req, _res, next) => {
            if (req.method !== 'GET') return next();
            const accept = req.headers.accept || '';
            if (!accept.includes('text/html')) return next();
            const url = req.url || '/';
            // Defer to Vite / proxy for assets, the SPA shell itself, and
            // proxied API prefixes. Plain deep links get the SPA index.
            if (
              url === '/' ||
              url === '/index.html' ||
              url.startsWith('/@') ||             // Vite client / HMR
              url.startsWith('/src/') ||          // Vite source modules
              url.startsWith('/node_modules/') ||
              url.startsWith('/assets/') ||
              url.startsWith('/api/') ||
              url.startsWith('/ollama') ||
              url.startsWith('/ai/') ||
              url.includes('.')
            ) {
              return next();
            }
            req.url = '/index.html';
            return next();
          });
        };
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  envDir: root,
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Heavy vendor libraries → separate long-lived cache buckets
          if (id.includes('node_modules/gsap'))                    return 'vendor-gsap'
          if (id.includes('node_modules/@mui/icons-material'))     return 'vendor-mui-icons'
          if (id.includes('node_modules/@mui/x-date-pickers'))     return 'vendor-mui-x'
          if (id.includes('node_modules/@mui'))                    return 'vendor-mui-core'
          if (id.includes('node_modules/@tanstack'))               return 'vendor-query'
          if (id.includes('node_modules/react-router'))            return 'vendor-router'
          // react/react-dom/react-is + @emotion stay together: emotion reads
          // react-is.AsyncMode at module-init, which is undefined if split
          // across chunks (cross-chunk CJS namespace init-order bug).
          if (id.includes('node_modules/@emotion'))                return 'vendor-react'
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom'))               return 'vendor-react'
          if (id.includes('node_modules/nostr-tools') ||
              id.includes('node_modules/@nostr-dev-kit'))          return 'vendor-nostr'
        },
      },
    },
  },
  resolve: {
    alias: {
      // Enforces a single React instance across all workspace packages
      'react':     path.resolve(appDir, 'node_modules/react'),
      'react-dom': path.resolve(appDir, 'node_modules/react-dom'),
    },
    // Prefer TS/TSX source over stale committed .js artifacts in workspace
    // packages (e.g. packages/ui/**) so edits are served live by HMR.
    // Keeps .mjs/.mts first for node_modules ESM fast-path.
    extensions: ['.mjs', '.mts', '.tsx', '.ts', '.js', '.jsx', '.json'],
  },
  // Workspace packages must NOT be pre-bundled — Vite serves them from source
  // so that edits to packages/ui/** are picked up by HMR without --force.
  //
  // `entries` widens the cold-start dependency crawl beyond index.html's
  // reachable graph to every source file. Without it, deps that are only
  // reachable through one of the 20+ lazy()-wrapped route chunks (or through
  // the always-mounted-but-conditionally-rendered AIAssistant panel, see
  // docs/decisions/285) aren't discovered at startup — Vite only finds them
  // the first time that code path actually renders in a browser tab, triggers
  // a mid-session "new dependencies optimized" re-bundle, and forces a full
  // reload while the module graph is incomplete. That reload is what was
  // showing up as a flash of half-styled, artifact-y UI on Home instead of
  // the loader. `entries` alone still missed a residual set of
  // @mui/icons-material named imports (the package re-exports ~2000 icons
  // through one barrel file, which the scanner doesn't fully resolve even
  // when reachable) — including the whole package covers those directly.
  optimizeDeps: {
    exclude: ['@ds/ui', '@ds/utils', '@ds/tokens'],
    entries: ['index.html', 'src/**/*.{ts,tsx}'],
    include: ['@mui/icons-material'],
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ''),
      },
      '/ai/chat': {
        target: 'http://localhost:4002',
        changeOrigin: true,
      },
      // ADR-281 D4 — capability report consumed by the Settings AI tab.
      '/ai/config': {
        target: 'http://localhost:4002',
        changeOrigin: true,
      },
      // ADR-371 — the public MCP gateway lives in the mcp-server process.
      // Dev parity with the beta nginx `location = /mcp` (beta-proxy.conf):
      // without this proxy the `/ai/connect` copy block (`${origin}/mcp`)
      // answers 404 in dev and bearer MCP sessions cannot start.
      '/mcp': {
        target: 'http://localhost:4002',
        changeOrigin: true,
      },
    },
    headers: {
      // connect-src must list every relay defined in nostr-relay-config.ts and nostr-dm-relays.ts
      'Content-Security-Policy': "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' http://localhost:4001 ws://localhost:4001 ws://*:4001 http://*:4001 http://localhost:11434 https://cdn.jsdelivr.net https://api.coingecko.com wss://relay.damus.io wss://nos.lol wss://relay.primal.net; default-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;",
    },
  },
})
