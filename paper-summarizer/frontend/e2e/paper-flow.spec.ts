import { expect, test } from '@playwright/test'
import { SAMPLE_PDF } from './global-setup.ts'

// MVP の1本道: アップロード → Step 1〜3 → 根拠チップで PDF へジャンプ → Q&A
test('upload a paper and read it through Step 1-3 and Q&A', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('デモモード（サンプルデータ）')).toBeVisible()

  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)

  // PDF が描画される
  await expect(page.locator('.pdf-page[data-page="1"]')).toBeVisible()

  // Step 1: 前提知識マップ（デモモードでも約1秒で届く）
  await expect(page.getByRole('heading', { name: '3行でつかむ' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '知らない' }).click()
  await expect(page.getByRole('heading', { name: /先に押さえておく概念/ })).toBeVisible()

  // Step 2: 段階を進めると PDF の根拠箇所が強調される
  await page.getByRole('tab', { name: /コアロジック/ }).click()
  await expect(page.getByRole('heading', { name: '手法の流れ' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.textLayer .hl').first()).toBeVisible()

  // Step 3: 自分の考えを書いてから解説を開く
  await page.getByRole('tab', { name: /批判的思考/ }).click()
  const reveal = page.getByRole('button', { name: '考えを書いたので解説を見る' })
  await expect(reveal).toBeDisabled({ timeout: 20_000 })
  await page.getByPlaceholder(/あなたの考えをメモ/).fill('実験の条件が少ないと思う')
  await reveal.click()
  await expect(page.getByText('論文の記述').first()).toBeVisible()
  await expect(page.getByText('AIの指摘・要検証').first()).toBeVisible()

  // Q&A: 根拠付きの回答が返る
  await page.getByPlaceholder('論文について質問する').fill('この手法の弱点は？')
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.locator('.msg.assistant .badge')).toBeVisible()
})

test('rejects a non-PDF file with a clear message', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByText('PDF ファイルを選んでください')).toBeVisible()
})

test('reuses the analysis when the same PDF is uploaded again', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)
  const firstUrl = page.url()
  // 解析が終わるまで待つ（完了した解析だけが再利用される）
  await page.getByRole('tab', { name: /批判的思考/ }).click()
  await expect(page.getByRole('button', { name: '書かずに見る' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 20_000 })

  await page.getByRole('link', { name: '新しい論文' }).click()
  await expect(page.getByRole('heading', { name: 'これまでの論文' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(firstUrl)
})
