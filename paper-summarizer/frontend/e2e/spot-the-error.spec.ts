import { expect, test } from '@playwright/test'
import { SAMPLE_PDF } from './global-setup.ts'

// 誤り探しモード: 問題を作る → 誤りだと思う文を選んで回答 → 答え合わせ。通常の解説には誤りの文が出ない
test('creates a spot-the-error quiz, answers it and sees the result', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/([0-9a-f]{16})$/)
  const paperId = page.url().match(/#\/paper\/([0-9a-f]{16})$/)![1]
  // 解析が終わるまで待つ（誤り探しは解析済みの論文だけ）
  await page.getByRole('tab', { name: /批判的思考/ }).click()
  await expect(page.getByRole('button', { name: '書かずに解説を見る' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 20_000 })

  await page.getByRole('tab', { name: /誤り探しモード/ }).click()
  await expect(page.getByText(/わざと誤りを混ぜた文が含まれます/)).toBeVisible()
  await page.getByRole('button', { name: '問題を作る' }).click()
  const boxes = page.getByRole('checkbox')
  await expect(boxes.first()).toBeVisible({ timeout: 20_000 })
  const count = await boxes.count()
  expect(count).toBeGreaterThanOrEqual(3)

  // 回答前は、どれが誤りかをブラウザが受け取っていない
  const before = await page.request.get(`/api/papers/${paperId}/quiz`)
  const bodyText = await before.text()
  expect(bodyText).not.toContain('"altered"')
  expect(bodyText).not.toContain('"original"')
  expect(bodyText).not.toContain('"evidence"')
  await expect(page.getByText('元の文')).toHaveCount(0)

  // 開き直しても同じ問題（作り直さない）
  const firstText = await page.locator('.quiz-rows li').first().innerText()
  await page.reload()
  await page.getByRole('tab', { name: /誤り探しモード/ }).click()
  await expect(page.locator('.quiz-rows li').first()).toHaveText(firstText, { timeout: 20_000 })

  // 全部の文を選ぶと、誤りは必ず見つかり、残りは「正しい文を誤りとした数」になる
  for (let i = 1; i <= count; i++) {
    await page.getByRole('checkbox', { name: new RegExp(`文${i}は`) }).check()
    await page.getByLabel(`文${i}の根拠ページ`).fill('1')
  }
  await page.getByRole('button', { name: '答え合わせ' }).click()
  await expect(page.getByText(/見つけた誤り [12] \/ [12] 件/)).toBeVisible()
  await expect(page.getByText(/正しい文を誤りとした数 \d+ 件/)).toBeVisible()

  // 誤りの文は元の文と並び、根拠ページを PDF で開ける
  const wrong = page.locator('.quiz-row.found').first()
  await expect(wrong.getByText('誤りの文')).toBeVisible()
  await expect(wrong.getByText('元の文')).toBeVisible()
  const alteredText = (await wrong.locator('.quiz-compare p').nth(1).innerText()).trim()
  await wrong.getByRole('button', { name: /根拠 p\.\d+ をPDFで開く/ }).click()
  await expect(page.locator('.textLayer .hl').first()).toBeVisible({ timeout: 20_000 })

  // 通常の解説（Step 1〜3）には、誤りの文が出ない
  for (const name of [/前提知識マップ/, /手法の流れと図表/, /批判的思考/]) {
    await page.getByRole('tab', { name }).click()
    await expect(page.locator('#step-panel')).not.toContainText(alteredText)
    await expect(page.locator('#step-panel')).not.toContainText('【デモ・誤り】')
  }
  const paper = await (await page.request.get(`/api/papers/${paperId}`)).text()
  expect(paper).not.toContain('【デモ・誤り】')

  // 新しい問題も作れる
  await page.getByRole('tab', { name: /誤り探しモード/ }).click()
  await page.getByRole('button', { name: '新しい問題' }).click()
  await expect(page.getByRole('checkbox').first()).toBeVisible({ timeout: 20_000 })
})
