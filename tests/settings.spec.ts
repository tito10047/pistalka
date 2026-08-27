import { expect, test } from '@playwright/test'
import { openSettings, readStoredSettings, recordWhistles, seedStorage, whistles } from './helpers'

test.beforeEach(async ({ page }) => {
  await recordWhistles(page)
})

test('nastavenia sa predvyplnia predvolenými hodnotami', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)

  await expect(page.getByLabel('Frekvencia')).toHaveValue('2800')
  await expect(page.getByLabel('Typ zvuku')).toHaveValue('classic')
  await expect(page.getByLabel('Dĺžka')).toHaveValue('600')
  await expect(page.getByLabel('Hlasitosť')).toHaveValue('1')
  await expect(page.getByTestId('frequency-value')).toHaveText('2800 Hz')
})

test('formulár sa predvyplní z uložených nastavení', async ({ page }) => {
  await seedStorage(page, {
    settings: { frequency: 3400, soundType: 'pealess', duration: 900, volume: 0.4 },
  })
  await page.goto('/')
  await openSettings(page)

  await expect(page.getByLabel('Frekvencia')).toHaveValue('3400')
  await expect(page.getByLabel('Typ zvuku')).toHaveValue('pealess')
  await expect(page.getByLabel('Dĺžka')).toHaveValue('900')
  await expect(page.getByLabel('Hlasitosť')).toHaveValue('0.4')
  await expect(page.getByTestId('volume-value')).toHaveText('40 %')
})

test('zmena frekvencie sa uloží a prežije obnovenie stránky', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)

  await page.getByLabel('Frekvencia').fill('3200')

  await expect(page.getByTestId('frequency-value')).toHaveText('3200 Hz')
  await expect
    .poll(async () => (await readStoredSettings(page))?.frequency)
    .toBe(3200)

  await page.reload()
  await openSettings(page)
  await expect(page.getByLabel('Frekvencia')).toHaveValue('3200')
})

test('zmena typu zvuku sa uloží a použije pri písknutí', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)

  await page.getByLabel('Typ zvuku').selectOption('pealess')

  await expect.poll(async () => (await readStoredSettings(page))?.soundType).toBe('pealess')

  await page.getByRole('button', { name: /zapískaj/i }).click()
  expect((await whistles(page))[0]).toMatchObject({ soundType: 'pealess' })
})

test('dĺžka a hlasitosť sa ukladajú a zobrazujú v čitateľných jednotkách', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)

  await page.getByLabel('Dĺžka').fill('1200')
  await page.getByLabel('Hlasitosť').fill('0.25')

  await expect(page.getByTestId('duration-value')).toHaveText('1,20 s')
  await expect(page.getByTestId('volume-value')).toHaveText('25 %')
  await expect
    .poll(async () => await readStoredSettings(page))
    .toMatchObject({ duration: 1200, volume: 0.25 })
})

test('tlačidlo Vyskúšať prehrá zvuk, ale nezapočíta sa do počítadla', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)

  await page.getByRole('button', { name: /vyskúšať/i }).click()

  expect(await whistles(page)).toHaveLength(1)
  await expect(page.getByTestId('counter')).toHaveText('0')
})

test('obnovenie predvolených hodnôt vráti nastavenia späť', async ({ page }) => {
  await seedStorage(page, {
    settings: { frequency: 1000, soundType: 'beep', duration: 150, volume: 0.1 },
  })
  await page.goto('/')
  await openSettings(page)

  await page.getByRole('button', { name: /predvolené/i }).click()

  await expect(page.getByLabel('Frekvencia')).toHaveValue('2800')
  await expect(page.getByLabel('Typ zvuku')).toHaveValue('classic')
  await expect.poll(async () => await readStoredSettings(page)).toMatchObject({
    frequency: 2800,
    soundType: 'classic',
    duration: 600,
    volume: 1,
  })
})
