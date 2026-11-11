import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1, // one WebGL-heavy page at a time
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome', // the installed Chrome, so no browser download is needed
    viewport: { width: 1000, height: 640 },
    launchOptions: {
      args: ['--ignore-gpu-blocklist', `--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`, '--enable-unsafe-swiftshader'],
    },
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
})
