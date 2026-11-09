import { expect, test } from '@playwright/test'
import { SAMPLE_PDF } from './global-setup.ts'

// デモモードの解析は数秒かけて進捗が進む。解析中の帯に、何をしているか・書いた文字数・経過時間が出る
test('the running analysis shows what it is doing, characters and elapsed time', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(SAMPLE_PDF)
  await expect(page).toHaveURL(/#\/paper\/[0-9a-f]{16}$/)

  const banner = page.locator('.analysis-running')
  const lines = banner.locator('.progress-step')
  // Step 1 を書いている途中（書いた文字数と秒数つき）
  await expect(lines.first()).toContainText(/Step 1：解説を書いています（約?[\d,]+字・\d+秒）/, { timeout: 20_000 })
  // Step 2 と Step 3 は同時に走るので、両方の行が出る
  await expect(banner.locator('.progress-step', { hasText: 'Step 2：' })).toBeVisible({ timeout: 20_000 })
  await expect(banner.locator('.progress-step', { hasText: 'Step 3：' })).toBeVisible({ timeout: 20_000 })
  // 狭い画面でも帯が横にはみ出さない
  await page.setViewportSize({ width: 360, height: 740 })
  const overflow = await banner.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  // 解析が終わると帯が消える
  await expect(banner).toBeHidden({ timeout: 30_000 })
})
