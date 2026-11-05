import { execFileSync } from 'node:child_process'
import path from 'node:path'

export const SAMPLE_PDF = path.resolve(import.meta.dirname, '.fixtures/sample-paper.pdf')

/** テスト用のサンプル論文 PDF を作る（前回のデータ削除は npm run e2e が webServer 起動前に行う）。 */
export default function globalSetup() {
  const backend = path.resolve(import.meta.dirname, '../../backend')
  execFileSync('uv', ['run', 'python', 'scripts/make_sample_pdf.py', SAMPLE_PDF, '3'], { cwd: backend, stdio: 'inherit' })
}
