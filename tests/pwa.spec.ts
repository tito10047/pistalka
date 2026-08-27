import { expect, test } from '@playwright/test'

test('stránka odkazuje na platný web app manifest', async ({ page, request }) => {
  await page.goto('/')

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()

  const manifest = await (await request.get(new URL(href!, page.url()).toString())).json()

  expect(manifest.name).toContain('Píšťalka')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true)
})

test('service worker sa zaregistruje a appka funguje offline', async ({ page, context }) => {
  await page.goto('/')

  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 20_000,
  })

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('button', { name: /zapískaj/i })).toBeVisible()
  await page.getByRole('button', { name: /zapískaj/i }).click()
  await expect(page.getByTestId('counter')).toHaveText('1')

  // Vykreslený panel ešte neznamená, že píšťalka píska – zvuk overíme aj bez siete.
  const peak = await page.evaluate(async () => {
    const buffer = await window.pistalka.renderWhistleOffline({
      frequency: 2800,
      soundType: 'classic',
      duration: 400,
      volume: 1,
    })
    const data = buffer.getChannelData(0)
    let max = 0
    for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]!))
    return max
  })
  expect(peak).toBeGreaterThan(0.3)

  await context.setOffline(false)
})

test('ikony uvedené v manifeste sú dostupné', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifestUrl = new URL(href!, page.url()).toString()
  const manifest = await (await request.get(manifestUrl)).json()

  for (const icon of manifest.icons as { src: string }[]) {
    const response = await request.get(new URL(icon.src, manifestUrl).toString())
    expect(response.status(), `ikona ${icon.src}`).toBe(200)
  }
})

test('appka je pripravená na pridanie na plochu iPhonu', async ({ page, request }) => {
  await page.goto('/')

  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  )
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Píšťalka',
  )

  const icon = page.locator('link[rel="apple-touch-icon"]')
  await expect(icon).toHaveAttribute('sizes', '180x180')

  const href = await icon.getAttribute('href')
  const response = await request.get(new URL(href!, page.url()).toString())
  expect(response.status()).toBe(200)
})
