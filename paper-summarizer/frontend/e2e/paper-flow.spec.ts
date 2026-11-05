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

  // Step 2: タブを開いただけでは PDF は動かず、段階を進めると根拠箇所が強調される
  await page.getByRole('tab', { name: /コアロジック/ }).click()
  await expect(page.getByRole('heading', { name: '手法の流れ' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.textLayer .hl')).toHaveCount(0)
  await page.getByRole('button', { name: '次の段階 →' }).click()
  await expect(page.locator('.textLayer .hl').first()).toBeVisible()

  // Step 3: 自分の考えを書いてから解説を開く
  await page.getByRole('tab', { name: /批判的思考/ }).click()
  const reveal = page.getByRole('button', { name: '考えを書いたので解説を見る' })
  await expect(reveal).toBeDisabled({ timeout: 20_000 })
  await page.getByPlaceholder(/あなたの考えをメモ/).fill('実験の条件が少ないと思う')
  // Step を切り替えると Step 2 の強調は消える
  await expect(page.locator('.textLayer .hl')).toHaveCount(0)
  await reveal.click()
  // 解説を開くと最初の項目までスクロールする
  await expect(page.locator('.reveal-start')).toBeInViewport()
  await expect(page.getByText('論文の記述').first()).toBeVisible()
  await expect(page.getByText('AIの指摘・要検証').first()).toBeVisible()

  // Q&A: 根拠付きの回答が返る
  await page.getByPlaceholder('論文について質問する').fill('この手法の弱点は？')
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.locator('.msg.assistant .badge')).toBeVisible()
})

test('moves the PDF highlight between pages and does not scroll back on resize', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)
  await page.getByRole('tab', { name: /コアロジック/ }).click()
  await expect(page.getByRole('heading', { name: '手法の流れ' })).toBeVisible({ timeout: 20_000 })

  // 段階1の根拠（1ページ目）→ 段階2の根拠（3ページ目）
  await page.locator('.stage').getByRole('button', { name: 'p.1' }).click()
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer .hl').first()).toBeVisible()
  await page.getByRole('button', { name: '次の段階 →' }).click()
  await expect(page.locator('.pdf-page[data-page="3"] .textLayer .hl').first()).toBeVisible()
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer .hl')).toHaveCount(0)

  // 手で先頭に戻してからウィンドウの大きさを変えても、引用の位置へ勝手に戻らない
  const scroller = page.locator('.pdf-scroll')
  await page.waitForTimeout(800) // smooth スクロールが終わるのを待つ
  await scroller.evaluate((el) => el.scrollTo({ top: 0 }))
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForTimeout(1000)
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(50)
  await expect(page.locator('.pdf-page[data-page="3"] .textLayer .hl').first()).toBeAttached()
})

test('remembers a jump requested before the PDF has loaded', async ({ page }) => {
  // PDF の配信だけを遅らせ、解説（Step 1）が先に表示される状況を作る
  await page.route('**/api/papers/*/pdf', async (route) => {
    await new Promise((r) => setTimeout(r, 3000))
    await route.continue()
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page.getByRole('heading', { name: 'おすすめの読む順番' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('PDF を読み込み中…')).toBeVisible()
  await page.locator('.reading-order').getByRole('button', { name: 'p.3' }).first().click()
  await expect(page.locator('.pdf-page[data-page="3"]')).toBeInViewport({ timeout: 10_000 })
})

test('Step content keeps at least half of the right pane on a 1440x900 screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page.getByRole('heading', { name: '3行でつかむ' })).toBeVisible({ timeout: 20_000 })
  const height = (selector: string) => page.locator(selector).evaluate((el) => el.clientHeight)
  const ratio = async () => (await height('.step-scroll')) / (await height('.pane-right'))
  // Q&A は最初は閉じていて、質問例は出ていない
  await expect(page.getByRole('button', { name: 'この手法の弱点は？' })).toBeHidden()
  expect(await ratio()).toBeGreaterThanOrEqual(0.5)
  // 質問すると開くが、それでも解説は半分以上
  await page.getByPlaceholder('論文について質問する').fill('この手法の弱点は？')
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.locator('.msg.assistant .badge')).toBeVisible()
  expect(await ratio()).toBeGreaterThanOrEqual(0.5)
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
