import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { localFunctionsPlugin } from './vite-plugin-api.ts'

export default defineConfig(({ mode }) => {
  // Load EVERY variable from .env (not just the VITE_ ones) into process.env so
  // the server functions can read their secrets while developing locally.
  // Only VITE_ variables are ever bundled into the browser code.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [react(), tailwindcss(), localFunctionsPlugin()],

    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },

    server: {
      port: 5173,
      // Lets you open the app from your phone on the same Wi-Fi to test the
      // BDM screens, including real GPS.
      host: true,
    },

    build: {
      rollupOptions: {
        output: {
          // Split the heavy libraries into separate files so the first page
          // load stays small on a phone with a weak connection.
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
              return 'react'
            if (id.includes('recharts') || id.includes('d3-')) return 'charts'
            if (id.includes('leaflet')) return 'maps'
            if (id.includes('xlsx')) return 'sheets'
            return undefined
          },
        },
      },
    },
  }
})
