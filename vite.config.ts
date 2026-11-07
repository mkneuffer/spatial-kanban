import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// WebXR requires a secure context. `localhost` counts as secure, but a headset on
// the LAN does not, so `npm run dev:https` serves a self-signed certificate.
// (Or keep plain HTTP and use `adb reverse tcp:5173 tcp:5173` on Quest.)
export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH ?? '/',
  // Short commit of the build (GitHub Actions / Cloudflare Pages), shown in the help dialog and the XR menu
  // so a headset can be checked against the deploy it should be running.
  define: { __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? 'dev').slice(0, 7)) },
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: true,
    // `npm run dev:sync`: forward the integrations API to `npm run worker:dev`.
    proxy: mode === 'sync' ? { '/api': 'http://localhost:8787' } : undefined,
  },
  // drei → stats-gl pins an older three; make sure only one copy is ever loaded.
  resolve: { dedupe: ['three'] },
  build: {
    target: 'es2022',
    // IWER's synthetic rooms are large lazy chunks that only the dev emulator ever loads.
    chunkSizeWarningLimit: 2500,
    // trailer.html: a standalone fake terminal used for recording the trailer.
    rollupOptions: { input: { main: 'index.html', trailer: 'trailer.html' } },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/worker/**/*.test.ts'],
  },
}))
