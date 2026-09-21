import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite only exposes VITE_-prefixed env vars to client code by default;
  // this whitelists GOOGLE_CLIENT_ID too so it works without that prefix.
  envPrefix: ['VITE_', 'GOOGLE_CLIENT_ID'],
})
