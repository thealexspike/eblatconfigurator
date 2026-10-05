import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // `npm run dev` servește doar interfața; API-ul rulează în `npm run dev:api`
  server: { proxy: { '/api': 'http://localhost:8788' } },
})
