import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  // `~/...` -> `src/...`, matching the tsconfig paths entry. Vite's dev module
  // runner does not read tsconfig paths, so it has to be declared here too.
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/` },
    ],
  },
  plugins: [tanstackStart(), react()],
})
