import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const baseURL = process.env.UI_BASE_URL || 'http://127.0.0.1:3001'
const output = process.env.UI_OUTPUT_DIR || `${tmpdir()}/nomoreats-ui-preview`
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors = []
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(baseURL)
    await page.getByRole('heading', { name: 'Your next chapter starts here.' }).waitFor()
    const label = viewport.width > 760 ? 'desktop' : 'mobile'
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} page overflow`)
    assert.equal(await page.getByRole('button', { name: 'Open navigation' }).isVisible(), label === 'mobile')
    assert.equal(await page.getByRole('columnheader', { name: 'Linked applications', exact: true }).isVisible(), label === 'desktop')
    assert.equal(await page.getByRole('columnheader', { name: 'Updated', exact: true }).isVisible(), label === 'desktop')
    assert.equal(await page.locator('.button-primary').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(22, 102, 93)')
    await page.screenshot({ path: `${output}/${label}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Tailor a resume', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Tailor a resume', exact: true }).waitFor()
    await page.screenshot({ path: `${output}/${label}-tailor.png`, fullPage: true })
    await page.getByRole('button', { name: 'Close dialog' }).click()
    if (label === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'My profile', exact: true }).click()
    await page.getByRole('heading', { name: 'My profile', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} profile overflow`)
    await page.screenshot({ path: `${output}/${label}-profile.png`, fullPage: true })
    console.log(`${label}: overview, tailoring dialog, navigation, profile and overflow checks passed`)
    await page.close()
  }
  assert.deepEqual(errors, [], 'Browser exceptions')
  console.log(`Screenshots: ${output}`)
} finally { await browser.close() }
