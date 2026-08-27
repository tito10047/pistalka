import { expect, test } from '@playwright/test'
import { readStoredCount, recordWhistles, seedStorage, whistles } from './helpers'

test.beforeEach(async ({ page }) => {
  await recordWhistles(page)
})

test('pri prvom spustení je počítadlo na nule', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('counter')).toHaveText('0')
  await expect(page.getByTestId('counter-label')).toHaveText('pískaní')
})

test('klik na Zapískaj zvýši počítadlo a prehrá zvuk', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /zapískaj/i }).click()

  await expect(page.getByTestId('counter')).toHaveText('1')
  await expect(page.getByTestId('counter-label')).toHaveText('písknutie')
  expect(await whistles(page)).toHaveLength(1)
})

test('opakované písknutia sa počítajú a skloňujú správne', async ({ page }) => {
  await page.goto('/')
  const button = page.getByRole('button', { name: /zapískaj/i })
  const counter = page.getByTestId('counter')
  const label = page.getByTestId('counter-label')

  await button.click()
  await button.click()
  await expect(counter).toHaveText('2')
  await expect(label).toHaveText('písknutia')

  for (let i = 0; i < 3; i++) await button.click()
  await expect(counter).toHaveText('5')
  await expect(label).toHaveText('pískaní')
  expect(await whistles(page)).toHaveLength(5)
})

test('reset vynuluje počítadlo', async ({ page }) => {
  await seedStorage(page, { count: 7 })
  await page.goto('/')
  await expect(page.getByTestId('counter')).toHaveText('7')

  await page.getByRole('button', { name: /vynulovať/i }).click()

  await expect(page.getByTestId('counter')).toHaveText('0')
  expect(await readStoredCount(page)).toBe('0')
})

test('počítadlo prežije obnovenie stránky', async ({ page }) => {
  await page.goto('/')
  const button = page.getByRole('button', { name: /zapískaj/i })
  await button.click()
  await button.click()
  await button.click()
  await expect(page.getByTestId('counter')).toHaveText('3')

  await page.reload()

  await expect(page.getByTestId('counter')).toHaveText('3')
})

test('písknutie použije nastavenia uložené v localStorage', async ({ page }) => {
  await seedStorage(page, {
    settings: { frequency: 1500, soundType: 'beep', duration: 250, volume: 0.5 },
  })
  await page.goto('/')

  await page.getByRole('button', { name: /zapískaj/i }).click()

  expect(await whistles(page)).toEqual([
    { frequency: 1500, soundType: 'beep', duration: 250, volume: 0.5 },
  ])
})

test('poškodené dáta v localStorage appku nezhodia', async ({ page }) => {
  await seedStorage(page, { settings: '{nie je json', count: -5 })
  await page.goto('/')

  await expect(page.getByTestId('counter')).toHaveText('0')
  await page.getByRole('button', { name: /zapískaj/i }).click()

  await expect(page.getByTestId('counter')).toHaveText('1')
  expect((await whistles(page))[0]).toMatchObject({ soundType: 'classic', frequency: 2800 })
})
