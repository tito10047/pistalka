import type { Page } from '@playwright/test'

export interface WhistleSettings {
  frequency: number
  soundType: 'classic' | 'pealess' | 'beep'
  duration: number
  volume: number
  boost: number
}

/** Appka si vstup normalizuje, takže ladiace API znesie aj nekompletné nastavenia. */
export type WhistleInput = Omit<WhistleSettings, 'boost'> & { boost?: number }

export const SETTINGS_KEY = 'pistalka.settings'
export const COUNT_KEY = 'pistalka.count'

declare global {
  interface Window {
    __whistles: WhistleSettings[]
    /** Ladiace API aplikácie – umožňuje analyzovať vyrenderovaný zvuk. */
    pistalka: {
      whistle(settings: WhistleInput): void
      renderWhistleOffline(settings: WhistleInput, sampleRate?: number): Promise<AudioBuffer>
    }
  }
}

/**
 * Zaznamenáva každé písknutie ešte pred spustením aplikácie.
 * Zvuk sa v headless prehliadači nedá počuť, event je náš pozorovací bod.
 */
export async function recordWhistles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__whistles = []
    document.addEventListener('pistalka:whistle', (event) => {
      window.__whistles.push((event as CustomEvent<WhistleSettings>).detail)
    })
  })
}

export function whistles(page: Page): Promise<WhistleSettings[]> {
  return page.evaluate(() => window.__whistles ?? [])
}

/** Naplní localStorage skôr, ako sa appka nabootuje. */
export async function seedStorage(
  page: Page,
  values: { settings?: unknown; count?: number },
): Promise<void> {
  await page.addInitScript(
    ([settingsKey, countKey, payload]) => {
      const data = payload as { settings?: unknown; count?: number }
      if (data.settings !== undefined) {
        localStorage.setItem(
          settingsKey as string,
          typeof data.settings === 'string' ? data.settings : JSON.stringify(data.settings),
        )
      }
      if (data.count !== undefined) localStorage.setItem(countKey as string, String(data.count))
    },
    [SETTINGS_KEY, COUNT_KEY, values] as const,
  )
}

export function readStoredSettings(page: Page): Promise<WhistleSettings | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as WhistleSettings) : null
  }, SETTINGS_KEY)
}

export function readStoredCount(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), COUNT_KEY)
}

export async function openSettings(page: Page): Promise<void> {
  const panel = page.getByTestId('settings')
  // <summary> Chromium nevystavuje ako rolu button, preto ho hľadáme priamo.
  if ((await panel.getAttribute('open')) === null) {
    await panel.locator('summary').click()
  }
}
