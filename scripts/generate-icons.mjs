// Vygeneruje PNG ikony pre PWA manifest zo SVG predlôh.
// Renderujeme cez Chromium (Playwright už máme kvôli testom) – na rozdiel od
// ImageMagicku zvládne gradienty a stroke presne tak, ako to vidno v prehliadači.
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const targets = [
  { svg: 'static/icons/favicon.svg', out: 'static/icons/icon-192.png', size: 192 },
  { svg: 'static/icons/favicon.svg', out: 'static/icons/icon-512.png', size: 512 },
  { svg: 'scripts/icon-maskable.svg', out: 'static/icons/icon-maskable-512.png', size: 512 },
  // iOS si ikonu maskuje sám a priehľadné rohy podkladá čiernou, preto favicon
  // (má zaoblené rohy) renderujeme na pozadí jej vlastnej farby – vznikne plný štvorec.
  {
    svg: 'static/icons/favicon.svg',
    out: 'static/icons/apple-touch-icon.png',
    size: 180,
    background: '#0b1220',
  },
]

const browser = await chromium.launch()

for (const target of targets) {
  const svg = await readFile(join(root, target.svg), 'utf8')
  const page = await browser.newPage({
    viewport: { width: target.size, height: target.size },
    deviceScaleFactor: 1,
  })
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:${target.background ?? 'transparent'}}svg{display:block;width:${target.size}px;height:${target.size}px}</style>${svg}`,
  )
  await page.screenshot({ path: join(root, target.out) })
  await page.close()
  console.log(`✓ ${target.out} (${target.size}×${target.size})`)
}

await browser.close()
