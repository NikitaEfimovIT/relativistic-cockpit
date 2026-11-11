import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves the site under the repository's name: the workflow sets PAGES_BASE=/relativistic-cockpit/
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] }, // e2e/ belongs to Playwright
})
