import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/oyoun-alhadid/',
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-v4.js`,
        chunkFileNames: `assets/[name]-[hash]-v4.js`,
      }
    }
  }
})
