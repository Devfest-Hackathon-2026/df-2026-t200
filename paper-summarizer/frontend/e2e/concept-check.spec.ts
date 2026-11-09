import { expect, test } from '@playwright/test'
import { SAMPLE_PDF } from './global-setup.ts'

// 確認モード: 問題に答えて前提知識を仕分ける。スマホ幅でも横にはみ出さない
test('sorts concepts by answering check questions, on a phone width too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/([0-9a-f]{16})$/)
  const paperId = page.url().match(/#\/paper\/([0-9a-f]{16})$/)![1]
  await expect(page.getByRole('heading', { name: '3行でつかむ' })).toBeVisible({ timeout: 20_000 })

  // 確認モードは最初は閉じている。1行の要約から開く
  await expect(page.getByText('確認モード：問題に答えて仕分ける')).toBeVisible()
  await page.locator('.concept-check > summary').click()
  const start = page.getByRole('button', { name: '問題に答えて仕分ける' })
  await expect(start).toBeEnabled()
  await expect(page.getByText(/AIが作った確認問題です/)).toBeVisible()
  await start.click()

  const groups = page.locator('.check-fieldset')
  await expect(groups.first()).toBeVisible({ timeout: 20_000 })
  const count = await groups.count()
  expect(count).toBeGreaterThanOrEqual(1)
  expect(count).toBeLessThanOrEqual(6)
  await expect(page.getByText('一般知識による問題').first()).toBeVisible()

  // 回答前は、正解も解説もブラウザが受け取っていない
  const body = await (await page.request.get(`/api/papers/${paperId}/check`)).text()
  for (const secret of ['correct_index', 'explanation', 'verdicts']) expect(body).not.toContain(secret)

  // 最初の問題だけ「分からない」、残りは先頭の選択肢を選ぶ
  for (let i = 0; i < count; i++) {
    const options = groups.nth(i).getByRole('radio')
    await (i === 0 ? options.last() : options.first()).check()
  }
  // 横にはみ出さない
  expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '答え合わせ' }).click()
  await expect(page.locator('.check-row').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/判定は「知らない」/).first()).toBeVisible()
  expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  // 印が付き、開き直しても残る。結果は同じ問題のまま（作り直さない）
  await expect(page.locator('.node-tag.unknown').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('.node-tag.unknown').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.check-row').first()).toBeVisible({ timeout: 20_000 })
})
