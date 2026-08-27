export type SoundType = 'classic' | 'pealess' | 'beep'

export interface WhistleSettings {
  /** Základná frekvencia tónu v Hz. */
  frequency: number
  soundType: SoundType
  /** Dĺžka písknutia v ms. */
  duration: number
  /** 0–1 */
  volume: number
  /**
   * 0–1. Nad nulou sa zvuk preženie mäkkým orezaním – zahustí priebeh k obdĺžniku,
   * takže pri rovnakej špičke nesie výrazne viac energie. Za hlasitosť sa platí
   * skreslením, preto je predvolene vypnutý a UI si prvé zapnutie pýta potvrdiť.
   */
  boost: number
}

export const SETTINGS_KEY = 'pistalka.settings'
export const COUNT_KEY = 'pistalka.count'

export const SOUND_TYPES: readonly SoundType[] = ['classic', 'pealess', 'beep']

export const SOUND_TYPE_LABELS: Record<SoundType, string> = {
  classic: 'Klasická (s guličkou)',
  pealess: 'Bezguličková (Fox 40)',
  beep: 'Pípnutie',
}

export const LIMITS = {
  frequency: { min: 800, max: 4500, step: 10 },
  duration: { min: 100, max: 2000, step: 50 },
  volume: { min: 0, max: 1, step: 0.05 },
  boost: { min: 0, max: 1, step: 0.25 },
} as const

export const DEFAULT_SETTINGS: WhistleSettings = {
  frequency: 2800,
  soundType: 'classic',
  duration: 600,
  volume: 1,
  boost: 0,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return clamp(n, min, max)
}

/** Doplní chýbajúce polia defaultmi a orežie hodnoty na povolený rozsah. */
export function normalizeSettings(raw: unknown): WhistleSettings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof WhistleSettings, unknown>
  >

  return {
    frequency: toNumber(
      input.frequency,
      DEFAULT_SETTINGS.frequency,
      LIMITS.frequency.min,
      LIMITS.frequency.max,
    ),
    soundType: SOUND_TYPES.includes(input.soundType as SoundType)
      ? (input.soundType as SoundType)
      : DEFAULT_SETTINGS.soundType,
    duration: toNumber(
      input.duration,
      DEFAULT_SETTINGS.duration,
      LIMITS.duration.min,
      LIMITS.duration.max,
    ),
    volume: toNumber(input.volume, DEFAULT_SETTINGS.volume, LIMITS.volume.min, LIMITS.volume.max),
    boost: toNumber(input.boost, DEFAULT_SETTINGS.boost, LIMITS.boost.min, LIMITS.boost.max),
  }
}

export function loadSettings(): WhistleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    // poškodený JSON alebo nedostupný localStorage (privátny režim)
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: WhistleSettings): WhistleSettings {
  const normalized = normalizeSettings(settings)
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized))
  } catch {
    // ignorujeme – appka funguje aj bez perzistencie
  }
  return normalized
}

export function loadCount(): number {
  try {
    const raw = localStorage.getItem(COUNT_KEY)
    const n = Number.parseInt(raw ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function saveCount(count: number): number {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  try {
    localStorage.setItem(COUNT_KEY, String(safe))
  } catch {
    // ignorujeme
  }
  return safe
}
