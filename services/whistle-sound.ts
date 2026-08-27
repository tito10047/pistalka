import { normalizeSettings, type WhistleSettings } from './settings-store'

/** Event vystrelený pri každom písknutí – hook pre testy a prípadné rozšírenia. */
export const WHISTLE_EVENT = 'pistalka:whistle'

let context: AudioContext | null = null
let master: GainNode | null = null

type AudioContextCtor = typeof AudioContext

function getAudioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * AudioContext sa vytvára lenivo až pri prvom užívateľskom geste –
 * prehliadače inak štart zvuku blokujú (autoplay policy).
 */
function ensureContext(): { ctx: AudioContext; out: GainNode } | null {
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null

  if (!context) {
    context = new Ctor()
    const gain = context.createGain()
    gain.gain.value = 1

    // Limiter je len poistka proti klipovaniu, nie hlasitostná úprava: prah tesne
    // pod plnou škálou, takže bežné písknutie ním prejde nedotknuté. Predtým tu bol
    // kompresor s prahom -18 dB a ratiom 12, ktorý stláčal celé písknutie
    // (merané RMS 0,26 oproti 0,36 na tej istej ceste s limiterom).
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -1
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.05

    gain.connect(limiter)
    limiter.connect(context.destination)
    master = gain
  }

  if (context.state === 'suspended') void context.resume()
  return master ? { ctx: context, out: master } : null
}

/** Odomkne audio pri prvom dotyku, aby prvé písknutie nemalo oneskorenie. */
export function unlockAudio(): void {
  ensureContext()
}

function createNoise(ctx: BaseAudioContext, duration: number): AudioBufferSourceNode {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * duration))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const source = ctx.createBufferSource()
  source.buffer = buffer
  return source
}

interface Voice {
  /** Uzly, ktoré treba spustiť a zastaviť. */
  sources: (OscillatorNode | AudioBufferSourceNode)[]
  output: AudioNode
}

/** Klasická píšťalka s guličkou: nosný tón + vrchné harmonické, trilkovanie z guličky. */
function buildClassic(ctx: BaseAudioContext, s: WhistleSettings, seconds: number): Voice {
  const mix = ctx.createGain()
  // Zložky sa v najhoršom prípade sčítajú na 1 + 0,28 + 0,08 + 0,12 = 1,48;
  // delíme, aby hlas vystupoval s vrcholom ~1 a obálka riadila hlasitosť sama.
  mix.gain.value = 1 / 1.48

  const fundamental = ctx.createOscillator()
  fundamental.type = 'sine'
  fundamental.frequency.value = s.frequency

  const partial = ctx.createOscillator()
  partial.type = 'sine'
  partial.frequency.value = s.frequency * 1.5
  const partialGain = ctx.createGain()
  partialGain.gain.value = 0.28

  const bright = ctx.createOscillator()
  bright.type = 'triangle'
  bright.frequency.value = s.frequency * 2
  const brightGain = ctx.createGain()
  brightGain.gain.value = 0.08

  // Gulička vo vnútri píšťalky moduluje výšku aj hlasitosť ~30× za sekundu.
  const trill = ctx.createOscillator()
  trill.type = 'sine'
  trill.frequency.value = 31
  const trillDepth = ctx.createGain()
  trillDepth.gain.value = s.frequency * 0.05
  trill.connect(trillDepth)
  trillDepth.connect(fundamental.frequency)
  trillDepth.connect(partial.frequency)
  trillDepth.connect(bright.frequency)

  const tremolo = ctx.createGain()
  tremolo.gain.value = 0.78
  const tremoloDepth = ctx.createGain()
  tremoloDepth.gain.value = 0.22
  trill.connect(tremoloDepth)
  tremoloDepth.connect(tremolo.gain)

  // Dychový šum – bez neho znie píšťalka ako čistý syntetizátor.
  const noise = createNoise(ctx, seconds)
  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'bandpass'
  noiseFilter.frequency.value = s.frequency
  noiseFilter.Q.value = 6
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.12

  fundamental.connect(mix)
  partial.connect(partialGain)
  partialGain.connect(mix)
  bright.connect(brightGain)
  brightGain.connect(mix)
  noise.connect(noiseFilter)
  noiseFilter.connect(noiseGain)
  noiseGain.connect(mix)
  mix.connect(tremolo)

  return { sources: [fundamental, partial, bright, trill, noise], output: tremolo }
}

/** Bezguličková píšťalka (Fox 40): dva blízke tóny, ktoré spolu „režú". */
function buildPealess(ctx: BaseAudioContext, s: WhistleSettings, seconds: number): Voice {
  const mix = ctx.createGain()
  // Rovnaká normalizácia ako pri klasickej: 1 + 0,75 + 0,18 + 0,1 = 2,03.
  mix.gain.value = 1 / 2.03

  const a = ctx.createOscillator()
  a.type = 'sine'
  a.frequency.value = s.frequency

  const b = ctx.createOscillator()
  b.type = 'sine'
  b.frequency.value = s.frequency * 1.19
  const bGain = ctx.createGain()
  bGain.gain.value = 0.75

  const c = ctx.createOscillator()
  c.type = 'sine'
  c.frequency.value = s.frequency * 1.5
  const cGain = ctx.createGain()
  cGain.gain.value = 0.18

  const noise = createNoise(ctx, seconds)
  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'bandpass'
  noiseFilter.frequency.value = s.frequency * 1.1
  noiseFilter.Q.value = 4
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.1

  a.connect(mix)
  b.connect(bGain)
  bGain.connect(mix)
  c.connect(cGain)
  cGain.connect(mix)
  noise.connect(noiseFilter)
  noiseFilter.connect(noiseGain)
  noiseGain.connect(mix)

  return { sources: [a, b, c, noise], output: mix }
}

/** Elektronické pípnutie. */
function buildBeep(ctx: BaseAudioContext, s: WhistleSettings): Voice {
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = s.frequency

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = s.frequency * 3
  osc.connect(filter)

  // Rezonancia filtra prestrelí obdĺžnik nad 1, stiahneme ho späť na vrchol ~1.
  const trim = ctx.createGain()
  trim.gain.value = 0.8
  filter.connect(trim)

  return { sources: [osc], output: trim }
}

const CURVE_SAMPLES = 2048
// Generika Float32Array<ArrayBuffer> je nutná – WaveShaper.curve nezoberie SharedArrayBuffer.
const curveCache = new Map<number, Float32Array<ArrayBuffer>>()

/**
 * Krivka mäkkého orezania (tanh) normalizovaná tak, aby vstup ±1 dal výstup ±1.
 * Drive musí byť **zapečený v krivke**, nie v predradenom zosilnení – WaveShaper
 * si vstup mimo ⟨-1, 1⟩ tak či tak oreže na krajný bod krivky.
 * Čím vyšší drive, tým bližšie k obdĺžniku, teda tým viac energie pri rovnakej špičke.
 */
function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const cached = curveCache.get(drive)
  if (cached) return cached

  const curve = new Float32Array(CURVE_SAMPLES)
  const norm = Math.tanh(drive)
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const x = (i / (CURVE_SAMPLES - 1)) * 2 - 1
    curve[i] = Math.tanh(drive * x) / norm
  }
  curveCache.set(drive, curve)
  return curve
}

/** Postaví a naplánuje jedno písknutie do ľubovoľného kontextu (živého aj offline). */
function scheduleWhistle(
  ctx: BaseAudioContext,
  destination: AudioNode,
  settings: WhistleSettings,
  startAt: number,
): void {
  const seconds = settings.duration / 1000
  const attack = 0.012
  const release = Math.min(0.09, seconds * 0.3)

  const voice =
    settings.soundType === 'classic'
      ? buildClassic(ctx, settings, seconds + release)
      : settings.soundType === 'pealess'
        ? buildPealess(ctx, settings, seconds + release)
        : buildBeep(ctx, settings)

  const envelope = ctx.createGain()
  const peak = Math.max(0.0001, settings.volume)
  envelope.gain.setValueAtTime(0.0001, startAt)
  envelope.gain.exponentialRampToValueAtTime(peak, startAt + attack)
  envelope.gain.setValueAtTime(peak, startAt + Math.max(attack, seconds - release))
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds)

  // Boost patrí PRED obálku – inak by orezanie zrovnalo aj nábeh a dozvuk.
  if (settings.boost > 0) {
    const shaper = ctx.createWaveShaper()
    shaper.curve = saturationCurve(2 + settings.boost * 8)
    shaper.oversample = '4x'

    // Prevzorkovanie tvarovača necháva na hranách zvlnenie do ~16 % nad jednotku;
    // trim ho vráti pod plnú škálu, aby výstup nezávisel od limitera.
    const trim = ctx.createGain()
    trim.gain.value = 0.86

    voice.output.connect(shaper)
    shaper.connect(trim)
    trim.connect(envelope)
  } else {
    voice.output.connect(envelope)
  }

  envelope.connect(destination)

  for (const source of voice.sources) {
    source.start(startAt)
    source.stop(startAt + seconds + 0.02)
  }

  const last = voice.sources[voice.sources.length - 1]
  if (last) last.onended = () => envelope.disconnect()
}

/**
 * Zapíska podľa nastavení. Bezstavové z pohľadu volajúceho –
 * všetky audio uzly sa po dohraní samé odpoja.
 */
export function whistle(settings: WhistleSettings): void {
  // Normalizujeme aj tu – funkcia je vystavená ako ladiace API `window.pistalka`.
  const safe = normalizeSettings(settings)
  document.dispatchEvent(new CustomEvent(WHISTLE_EVENT, { detail: safe }))

  const audio = ensureContext()
  if (!audio) return
  scheduleWhistle(audio.ctx, audio.out, safe, audio.ctx.currentTime)
}

/**
 * Vyrenderuje písknutie do bufferu bez prehrávania.
 * Slúži na automatizovanú kontrolu, že zvuk naozaj znie – v testoch aj v konzole.
 */
export function renderWhistleOffline(
  settings: WhistleSettings,
  sampleRate = 48000,
): Promise<AudioBuffer> {
  const safe = normalizeSettings(settings)
  const seconds = safe.duration / 1000
  const frames = Math.ceil((seconds + 0.05) * sampleRate)
  const ctx = new OfflineAudioContext(1, frames, sampleRate)
  scheduleWhistle(ctx, ctx.destination, safe, 0)
  return ctx.startRendering()
}
