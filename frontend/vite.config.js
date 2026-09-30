import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite only exposes VITE_-prefixed env vars to client code by default;
  // this whitelists API_URL and GOOGLE_CLIENT_ID too so they work without that prefix.
  envPrefix: ['VITE_', 'API_URL', 'GOOGLE_CLIENT_ID'],
})
