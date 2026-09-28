import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// WebXR requires a secure context. `localhost` counts as secure, but a headset on
// the LAN does not, so `npm run dev:https` serves a self-signed certificate.
// (Or keep plain HTTP and use `adb reverse tcp:5173 tcp:5173` on Quest.)
export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH ?? '/',
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
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/worker/**/*.test.ts'],
  },
}))
