import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// e2e はデモモードのバックエンド（Gemini を呼ばない）と Vite の dev サーバーを起動して、実際の画面を操作する。
const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? path.resolve(import.meta.dirname, '../backend/.e2e-data')

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/api/health',
      env: { DEMO_MODE: '1', DATA_DIR: E2E_DATA_DIR },
      reuseExistingServer: false, // 起動中の dev サーバー（デモモードでない可能性）に接続しない
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false, // 起動中の dev サーバー（デモモードでない可能性）に接続しない
      timeout: 120_000,
    },
  ],
})
