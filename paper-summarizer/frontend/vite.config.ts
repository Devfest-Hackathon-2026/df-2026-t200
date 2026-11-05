import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// ローカル開発: /api をバックエンド（FastAPI, :8000）へ中継する
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
})
