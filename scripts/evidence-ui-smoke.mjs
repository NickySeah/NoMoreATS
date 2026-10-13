import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const baseURL = process.env.UI_BASE_URL || 'http://127.0.0.1:3001'
const output = `${tmpdir()}/nomoreats-evidence-review`
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const job = { company: 'Fixture company', role: 'Engineer', description: 'Build services and own CI/CD pipelines.', url: '', instructions: '' }
const errors = []
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    page.on('pageerror', error => errors.push(error.message))
    let profile, analyzeCount = 0, saves = [], generations = []
    await page.route('**/api/state', async route => {
      const state = await (await route.fetch()).json()
      profile ||= state.profile
      state.profile = profile
      state.settings = { ...state.settings, apiKeyConfigured: true, model: 'test/model' }
      await route.fulfill({ json: state })
    })
    await page.route('**/api/evidence/analyze', async route => {
      analyzeCount++
      if (analyzeCount === 1) return route.fulfill({ status: 400, json: { error: 'Fixture analysis failure. Retry analysis.' } })
      await route.fulfill({ json: { reviewId: 'fixture-review', summary: 'Confirm CI/CD ownership.', groups: [{ id: 'experience.govtech', label: 'Engineer at GovTech' }], questions: [{ id: 'q1', term: 'CI/CD', importance: 'required', sourceQuote: 'own CI/CD pipelines', evidenceIds: [], suggestedGroup: 'experience.govtech', question: 'Have you personally built CI/CD pipelines? Describe your contribution, tools and role.' }] } })
    })
    await page.route('**/api/evidence/save', async route => {
      const body = route.request().postDataJSON(); saves.push(body)
      profile.experience[0].notes = [profile.experience[0].notes, body.answers[0].text].filter(Boolean).join('\n\n')
      await route.fulfill({ json: { reviewId: 'fixture-review', profile, savedCount: 1 } })
    })
    await page.route('**/api/tailor', async route => {
      generations.push(route.request().postDataJSON())
      await route.fulfill({ status: 400, json: { error: 'Fixture generation failure. Saved answers are intact.' } })
    })
    await page.goto(baseURL)
    await page.getByRole('button', { name: 'Tailor a resume', exact: true }).first().click()
    await page.getByLabel('Company', { exact: true }).fill(job.company)
    await page.getByLabel('Role', { exact: true }).fill(job.role)
    await page.getByLabel('Full job description', { exact: true }).fill(job.description)
    await page.getByRole('button', { name: 'Analyze job requirements', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Fixture analysis failure' }).waitFor()
    assert.equal(generations.length, 0)
    await page.getByRole('button', { name: 'Analyze job requirements', exact: true }).click()
    await page.getByRole('heading', { name: 'Review your evidence', exact: true }).waitFor()
    await page.getByLabel('Response for CI/CD').selectOption('no-experience')
    assert.equal(await page.getByLabel('Your factual answer').count(), 0)
    await page.getByLabel('Response for CI/CD').selectOption('skip')
    await page.getByLabel('Response for CI/CD').selectOption('answer')
    await page.getByLabel('Your factual answer').fill('I built CI/CD pipelines using GitHub Actions for GovTech APIs.')
    await page.getByLabel('Save to existing entry').selectOption('experience.govtech')
    assert.equal(generations.length, 0)
    await page.screenshot({ path: `${output}/${width}-review.png`, fullPage: true })
    await page.getByRole('button', { name: 'Save confirmed answers', exact: true }).click()
    await page.getByText('Confirmed answers saved to your profile.', { exact: true }).waitFor()
    assert.equal(saves.length, 1)
    assert.equal(saves[0].answers[0].group, 'experience.govtech')
    assert.equal(saves[0].answers[0].text, 'I built CI/CD pipelines using GitHub Actions for GovTech APIs.')
    assert.equal(generations.length, 0)
    await page.getByRole('button', { name: 'Generate resume', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Fixture generation failure' }).waitFor()
    assert.equal(generations[0].reviewId, 'fixture-review')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.getByRole('button', { name: 'Back to job details', exact: true }).click()
    assert.equal(await page.getByLabel('Full job description').inputValue(), job.description)
    await page.getByRole('button', { name: 'Close dialog' }).click()
    if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'My profile', exact: true }).click()
    assert.equal(await page.getByLabel('Additional factual evidence').first().inputValue().then(text => text.includes('GitHub Actions')), true)
    if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await page.getByRole('button', { name: 'Tailor a resume', exact: true }).first().click()
    await page.getByLabel('Company', { exact: true }).fill(job.company)
    await page.getByLabel('Role', { exact: true }).fill(job.role)
    await page.getByLabel('Full job description').fill(job.description)
    await page.route('**/api/evidence/analyze', route => route.fulfill({ json: { reviewId: 'empty-review', summary: 'Your saved evidence is sufficient.', groups: [], questions: [] } }))
    await page.route('**/api/evidence/save', route => route.fulfill({ json: { reviewId: 'empty-review', profile, savedCount: 0 } }))
    await page.getByRole('button', { name: 'Analyze job requirements', exact: true }).click()
    await page.getByText('No additional questions.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Confirm review', exact: true }).click()
    await page.getByRole('button', { name: 'Generate resume', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Close dialog' }).click()
    await page.route('**/api/state', async route => {
      const state = await (await route.fetch()).json()
      state.settings = { ...state.settings, apiKeyConfigured: false, model: '' }
      await route.fulfill({ json: state })
    })
    await page.reload()
    await page.getByRole('button', { name: 'Tailor a resume', exact: true }).first().click()
    assert.equal(await page.getByRole('button', { name: 'Analyze job requirements', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Open Settings' }).click()
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
    console.log(`${width}px: analysis/retry, answer/no/skip, explicit save, profile synchronization, generation gating/error, navigation, no questions and no-key setup passed`)
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
