import { expect, test } from '@playwright/test'
import type { WhistleInput } from './helpers'

/**
 * Zvuk renderujeme cez OfflineAudioContext priamo v prehliadači a analyzujeme vzorky.
 * Bez toho by testy prešli aj vtedy, keby píšťalka bola úplne tichá.
 */
async function analyze(
  page: import('@playwright/test').Page,
  // boost je voliteľný, appka si ho doplní na 0 – testy tak ostávajú čitateľné.
  settings: WhistleInput,
) {
  return page.evaluate(async (config) => {
    const buffer = await window.pistalka.renderWhistleOffline(config)
    const data = buffer.getChannelData(0)

    let peak = 0
    let sumSquares = 0
    let zeroCrossings = 0
    for (let i = 0; i < data.length; i++) {
      const sample = data[i]!
      peak = Math.max(peak, Math.abs(sample))
      sumSquares += sample * sample
      if (i > 0 && Math.sign(sample) !== Math.sign(data[i - 1]!) && sample !== 0) zeroCrossings++
    }

    // Obálka po 5 ms oknách – z jej rozptylu poznáme trilkovanie guličky.
    const frame = Math.round(buffer.sampleRate * 0.005)
    const envelope: number[] = []
    for (let start = 0; start + frame <= data.length; start += frame) {
      let max = 0
      for (let i = start; i < start + frame; i++) max = Math.max(max, Math.abs(data[i]!))
      envelope.push(max)
    }
    // Hodnotíme len ustálenú časť, aby attack/release neskresľovali rozptyl.
    const steady = envelope.slice(
      Math.floor(envelope.length * 0.2),
      Math.floor(envelope.length * 0.8),
    )
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length
    const variation =
      mean > 0
        ? Math.sqrt(steady.reduce((a, b) => a + (b - mean) ** 2, 0) / steady.length) / mean
        : 0

    return {
      peak,
      rms: Math.sqrt(sumSquares / data.length),
      zeroCrossingRate: zeroCrossings / (data.length / buffer.sampleRate),
      durationSeconds: buffer.duration,
      sampleRate: buffer.sampleRate,
      envelopeVariation: variation,
    }
  }, settings)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('klasická píšťalka je počuteľná, nie ticho', async ({ page }) => {
  const result = await analyze(page, {
    frequency: 2800,
    soundType: 'classic',
    duration: 600,
    volume: 1,
  })

  expect(result.peak).toBeGreaterThan(0.3)
  expect(result.rms).toBeGreaterThan(0.05)
})

test('všetky typy zvuku vydávajú signál', async ({ page }) => {
  for (const soundType of ['classic', 'pealess', 'beep'] as const) {
    const result = await analyze(page, { frequency: 2800, soundType, duration: 400, volume: 1 })
    expect(result.peak, soundType).toBeGreaterThan(0.3)
    expect(result.rms, soundType).toBeGreaterThan(0.05)
  }
})

test('dĺžka zvuku zodpovedá nastaveniu', async ({ page }) => {
  const short = await analyze(page, {
    frequency: 2800,
    soundType: 'beep',
    duration: 200,
    volume: 1,
  })
  const long = await analyze(page, {
    frequency: 2800,
    soundType: 'beep',
    duration: 1500,
    volume: 1,
  })

  expect(short.durationSeconds).toBeGreaterThan(0.2)
  expect(short.durationSeconds).toBeLessThan(0.35)
  expect(long.durationSeconds).toBeGreaterThan(1.5)
  expect(long.durationSeconds).toBeLessThan(1.65)
})

test('hlasitosť škáluje amplitúdu', async ({ page }) => {
  const full = await analyze(page, { frequency: 2800, soundType: 'beep', duration: 400, volume: 1 })
  const quiet = await analyze(page, {
    frequency: 2800,
    soundType: 'beep',
    duration: 400,
    volume: 0.25,
  })

  expect(quiet.rms).toBeLessThan(full.rms * 0.5)
  expect(quiet.rms).toBeGreaterThan(0)
})

test('nastavená frekvencia sa prejaví vo výške tónu', async ({ page }) => {
  const low = await analyze(page, { frequency: 1000, soundType: 'beep', duration: 1000, volume: 1 })
  const high = await analyze(page, { frequency: 3000, soundType: 'beep', duration: 1000, volume: 1 })

  // Obdĺžnikový priebeh prechádza nulou dvakrát za periódu.
  expect(low.zeroCrossingRate).toBeGreaterThan(1700)
  expect(low.zeroCrossingRate).toBeLessThan(2300)
  expect(high.zeroCrossingRate).toBeGreaterThan(5100)
  expect(high.zeroCrossingRate).toBeLessThan(6900)
})

test('píšťalka využíva dynamický rozsah, nie je zbytočne potichu', async ({ page }) => {
  // Strážime regresiu, keď master kompresor stláčal výstup na ~16 % škály.
  for (const soundType of ['classic', 'pealess', 'beep'] as const) {
    const result = await analyze(page, { frequency: 2800, soundType, duration: 600, volume: 1 })
    expect(result.peak, soundType).toBeGreaterThan(0.7)
    expect(result.peak, soundType).toBeLessThanOrEqual(1.01)
    expect(result.rms, soundType).toBeGreaterThan(0.2)
  }
})

test('boost pridá hlasitosť bez toho, aby prekročil plnú škálu', async ({ page }) => {
  const base = { frequency: 2800, soundType: 'classic', duration: 600, volume: 1 } as const

  const off = await analyze(page, { ...base, boost: 0 })
  const half = await analyze(page, { ...base, boost: 0.5 })
  const full = await analyze(page, { ...base, boost: 1 })

  // Energia (RMS) rastie, hoci špička ostáva pod jednotkou – to je celý zmysel boostu.
  expect(half.rms).toBeGreaterThan(off.rms * 1.15)
  expect(full.rms).toBeGreaterThan(half.rms)
  expect(full.peak).toBeLessThanOrEqual(1.01)
})

test('boost funguje pri každom type zvuku', async ({ page }) => {
  for (const soundType of ['classic', 'pealess', 'beep'] as const) {
    const off = await analyze(page, { frequency: 2800, soundType, duration: 400, volume: 1 })
    const on = await analyze(page, {
      frequency: 2800,
      soundType,
      duration: 400,
      volume: 1,
      boost: 1,
    })
    expect(on.rms, soundType).toBeGreaterThan(off.rms)
  }
})

test('boost neruší hlasitosť ani dĺžku', async ({ page }) => {
  const quiet = await analyze(page, {
    frequency: 2800,
    soundType: 'classic',
    duration: 300,
    volume: 0.2,
    boost: 1,
  })

  expect(quiet.peak).toBeLessThan(0.35)
  expect(quiet.durationSeconds).toBeLessThan(0.45)
})

test('klasická píšťalka trilkuje, pípnutie je rovné', async ({ page }) => {
  const classic = await analyze(page, {
    frequency: 2800,
    soundType: 'classic',
    duration: 800,
    volume: 1,
  })
  const beep = await analyze(page, {
    frequency: 2800,
    soundType: 'beep',
    duration: 800,
    volume: 1,
  })

  expect(classic.envelopeVariation).toBeGreaterThan(0.05)
  expect(beep.envelopeVariation).toBeLessThan(classic.envelopeVariation)
})
