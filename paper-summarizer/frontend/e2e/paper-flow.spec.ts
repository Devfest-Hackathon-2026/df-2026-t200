import { expect, test } from '@playwright/test'
import { SAMPLE_PDF } from './global-setup.ts'

// MVP の1本道: アップロード → Step 1〜3 → 根拠チップで PDF へジャンプ → Q&A
test('upload a paper and read it through Step 1-3 and Q&A', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('デモモード（サンプルデータ）')).toBeVisible()

  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)

  // PDF が描画される（サーバーを起動した直後は pdf.js の準備に時間がかかる）
  await expect(page.locator('.pdf-page[data-page="1"]')).toBeVisible({ timeout: 20_000 })

  // Step 1: 前提知識マップ（デモモードでも約1秒で届く）
  await expect(page.getByRole('heading', { name: '3行でつかむ' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '知らない' }).click()
  await expect(page.getByRole('heading', { name: /先に押さえておく概念/ })).toBeVisible()

  // Step 2: タブを開いた時点で最初の段階の根拠が強調され、段階を進めると次の根拠へ移る
  await page.getByRole('tab', { name: /手法の流れと図表/ }).click()
  await expect(page.getByRole('heading', { name: '手法の流れ' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.textLayer .hl').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '次の段階へ' }).click()
  await expect(page.locator('.textLayer .hl').first()).toBeVisible({ timeout: 20_000 })

  // Step 3: 自分の考えを書いてから解説を開く
  await page.getByRole('tab', { name: /批判的思考/ }).click()
  const reveal = page.getByRole('button', { name: '解説を見る', exact: true })
  await expect(reveal).toBeDisabled({ timeout: 20_000 })
  await page.getByPlaceholder('このブラウザにだけ保存します').fill('実験の条件が少ないと思う')
  // Step を切り替えると Step 2 の強調は消える
  await expect(page.locator('.textLayer .hl')).toHaveCount(0)
  await reveal.click()
  // 解説を開くと最初の項目までスクロールする
  await expect(page.locator('.reveal-start')).toBeInViewport({ timeout: 20_000 })
  await expect(page.getByText('論文の記述').first()).toBeVisible()
  await expect(page.getByText('AIの指摘（要検証）').first()).toBeVisible()

  // Q&A: 根拠付きの回答が返る
  await page.getByPlaceholder('質問を入力').fill('この手法の弱点は？')
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.locator('.msg.assistant .badge')).toBeVisible()
})

test('moves the PDF highlight between pages and does not scroll back on resize', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)
  await page.getByRole('tab', { name: /手法の流れと図表/ }).click()
  await expect(page.getByRole('heading', { name: '手法の流れ' })).toBeVisible({ timeout: 20_000 })

  // 段階1の根拠（1ページ目）→ 段階2の根拠（3ページ目）
  await page.locator('.stage').getByRole('button', { name: /^p\.1/ }).click()
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer .hl').first()).toBeVisible()
  await page.getByRole('button', { name: '次の段階へ' }).click()
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
  await expect(page.getByRole('heading', { name: '読む順番' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('PDFを読み込んでいます…')).toBeVisible()
  await page.locator('.reading-order').getByRole('button', { name: 'p.3を開く' }).first().click()
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
  await page.getByPlaceholder('質問を入力').fill('この手法の弱点は？')
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.locator('.msg.assistant .badge')).toBeVisible()
  expect(await ratio()).toBeGreaterThanOrEqual(0.5)
})

test('drags the middle bar to resize the PDF and explanation, and keeps the width after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page.locator('.pdf-page[data-page="1"]')).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('separator', { name: 'PDFと解説の幅' })
  const width = (selector: string) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().width)
  const pdfBefore = await width('.pdf-page[data-page="1"]')

  const box = (await bar.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(420, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  // 左は 420px 前後、右はそのぶん広がる。PDF もペインの幅に合わせて描き直される
  expect(Math.abs((await width('.pane-left')) - 414)).toBeLessThan(12)
  expect(await width('.pane-right')).toBeGreaterThan(900)
  await expect.poll(() => width('.pdf-page[data-page="1"]')).toBeLessThan(pdfBefore - 100)

  // 端まで寄せても、解説には読める幅が残る
  await bar.focus()
  await page.keyboard.press('End')
  // 1400px では 75% だと解説が 380px を切るので、上限は 72.4%
  await expect(bar).toHaveAttribute('aria-valuemax', '72.4')
  await expect(bar).toHaveAttribute('aria-valuenow', '72.4')
  expect(await width('.pane-right')).toBeGreaterThanOrEqual(380)

  // 狭い PC の画面では、最小幅を守れる範囲までしか動かず、値と見た目の幅が一致する
  await page.setViewportSize({ width: 901, height: 800 })
  await expect(bar).toHaveAttribute('aria-valuenow', '57.1')
  const total = await width('.workspace')
  expect(Math.abs((await width('.pane-left')) / total - 0.571)).toBeLessThan(0.01)
  expect(await width('.pane-right')).toBeGreaterThanOrEqual(380)
  await page.setViewportSize({ width: 1400, height: 900 })
  await expect(bar).toHaveAttribute('aria-valuenow', '72.4')

  await bar.focus()
  await page.keyboard.press('Home')
  await page.reload()
  await expect(page.getByRole('separator', { name: 'PDFと解説の幅' })).toHaveAttribute('aria-valuenow', '25')

  // スマホの幅ではバーを出さず、タブで切り替える
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('separator', { name: 'PDFと解説の幅' })).toBeHidden()
})

test('fits a 390px phone screen and switches between PDF and explanation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const noHorizontalScroll = async () => {
    const [scroll, client] = await page.locator('html').evaluate((el) => [el.scrollWidth, el.clientWidth])
    expect(scroll).toBeLessThanOrEqual(client)
  }
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'PDFを選択' })).toBeVisible()
  await noHorizontalScroll()

  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page.getByRole('heading', { name: '3行でつかむ' })).toBeVisible({ timeout: 20_000 })
  await noHorizontalScroll()
  // 上部のバーは1行に収まり、「別の論文を開く」が縦に折り返さない
  const button = await page.getByRole('link', { name: '別の論文を開く' }).boundingBox()
  expect(button!.height).toBeLessThan(48)
  expect((await page.locator('.topbar').boundingBox())!.height).toBeLessThan(70)
  // Step のタブは3つとも画面内に収まる
  for (const name of [/前提知識/, /手法の流れと図表/, /批判的思考/]) {
    const box = (await page.getByRole('tab', { name }).boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  // PDF と解説は上下に並ばず、タブで切り替える
  await expect(page.locator('.pdf-scroll')).toBeHidden()
  await page.getByRole('tab', { name: 'PDF' }).click()
  await expect(page.locator('.pdf-page[data-page="1"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '3行でつかむ' })).toBeHidden()
  // PDF は画面の幅に収まる
  await expect.poll(async () => (await page.locator('.pdf-page[data-page="1"]').boundingBox())!.width).toBeLessThanOrEqual(390)
  await noHorizontalScroll()
  // 解説の根拠チップを押すと PDF 側に切り替わる
  await page.getByRole('tab', { name: '解説' }).click()
  await page.locator('.reading-order').getByRole('button', { name: 'p.3を開く' }).first().click()
  await expect(page.locator('.pdf-page[data-page="3"]')).toBeInViewport()
})

test('on a phone, a page chip opens the PDF at that page even though the PDF was hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page.getByRole('heading', { name: '読む順番' })).toBeVisible({ timeout: 20_000 })
  // PDF タブを一度も開かずに、後ろのページのチップを押す
  await page.locator('.reading-order').getByRole('button', { name: 'p.3を開く' }).first().click()
  await expect(page.getByRole('tab', { name: 'PDF' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.pdf-page[data-page="3"]')).toBeInViewport({ ratio: 0.9 })
  await page.waitForTimeout(500) // 幅が決まった後の描き直しでずれないこと
  await expect(page.locator('.pdf-page[data-page="3"]')).toBeInViewport({ ratio: 0.9 })
})

test('rejects a non-PDF file with a clear message', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByText('選んだファイルはPDFではありません。PDFファイルを選んでください。')).toBeVisible()
})

test('reuses the analysis when the same PDF is uploaded again', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)
  const firstUrl = page.url()
  // 解析が終わるまで待つ（完了した解析だけが再利用される）
  await page.getByRole('tab', { name: /批判的思考/ }).click()
  await expect(page.getByRole('button', { name: '書かずに解説を見る' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 20_000 })

  await page.getByRole('link', { name: '別の論文を開く' }).click()
  await expect(page.getByRole('heading', { name: 'これまでの論文' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  // 論文の記録はアップロードごとに新しく作り、解析結果だけを写す（他人の会話は見えない）
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)
  expect(page.url()).not.toBe(firstUrl)
  await page.getByRole('tab', { name: /批判的思考/ }).click()
  await expect(page.getByRole('button', { name: '書かずに解説を見る' })).toBeVisible({ timeout: 5_000 })
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`keeps the page fixed to the viewport at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    // e2e の型設定には DOM がないので、式を文字列で渡す
    const pageScroll = () => page.evaluate<number[]>('[window.scrollY, document.scrollingElement.scrollTop]')
    await page.goto('/')
    await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
    await page.getByRole('tab', { name: /批判的思考/ }).click()
    await page.getByRole('button', { name: '書かずに解説を見る' }).click({ timeout: 20_000 })
    await expect(page.locator('.reveal-start')).toBeInViewport({ timeout: 20_000 })
    await expect.poll(pageScroll).toEqual([0, 0])
    // 根拠チップで PDF へ移動する（狭い画面では PDF タブに切り替わる）
    await page
      .locator('.columns')
      .getByRole('button', { name: /^p\.\d/ })
      .first()
      .click()
    await expect(page.locator('.textLayer .hl').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.textLayer .hl').first()).toBeInViewport()
    await expect.poll(pageScroll).toEqual([0, 0])
    if (viewport.width <= 900) await page.getByRole('tab', { name: '解説' }).click()
    await page.getByPlaceholder('質問を入力').fill('この手法の弱点は？')
    await page.getByRole('button', { name: '送信' }).click()
    await expect(page.locator('.msg.assistant .badge')).toBeVisible()
    await expect.poll(pageScroll).toEqual([0, 0])
  })
}
