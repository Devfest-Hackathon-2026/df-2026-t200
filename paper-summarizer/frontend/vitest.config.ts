import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        // PdfViewer・PageView（pdf.js + canvas）と起動処理は jsdom で動かないため e2e で確認する
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test/**',
          'src/main.tsx',
          'src/components/PdfViewer.tsx',
          'src/components/PageView.tsx',
          'src/components/PdfPageImage.tsx',
        ],
        thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
      },
    },
  }),
)
