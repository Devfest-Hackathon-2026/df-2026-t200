// 一時ファイル（コミットしない）: :5173 が別プロジェクトで使用中のため、e2e を別ポートで動かす
import base from './playwright.config'
const [api, web] = base.webServer as any[]
export default {
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5373' },
  webServer: [
    { ...api, command: 'uv run uvicorn app.main:app --port 8200', url: 'http://localhost:8200/api/health' },
    { ...web, command: 'npx vite --config /tmp/claude-1000/-home-satosho-DevFesHack-2026-DevFesHack/0a0966e2-f61d-46d0-ab1f-b733ae7d40d3/scratchpad/vite.e2e-8200.config.mjs', url: 'http://localhost:5373' },
  ],
}
