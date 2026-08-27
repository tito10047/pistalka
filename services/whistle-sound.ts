import type { WhistleSettings } from './settings-store'

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

    // Kompresor drží zvuk hlasný a bez klipovania aj pri plnej hlasitosti.
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.knee.value = 12
    compressor.ratio.value = 12
    compressor.attack.value = 0.002
    compressor.release.value = 0.15

    gain.connect(compressor)
    compressor.connect(context.destination)
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
  mix.gain.value = 1

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
  mix.gain.value = 1

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

  return { sources: [osc], output: filter }
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

  voice.output.connect(envelope)
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
  document.dispatchEvent(new CustomEvent(WHISTLE_EVENT, { detail: { ...settings } }))

  const audio = ensureContext()
  if (!audio) return
  scheduleWhistle(audio.ctx, audio.out, settings, audio.ctx.currentTime)
}

/**
 * Vyrenderuje písknutie do bufferu bez prehrávania.
 * Slúži na automatizovanú kontrolu, že zvuk naozaj znie – v testoch aj v konzole.
 */
export function renderWhistleOffline(
  settings: WhistleSettings,
  sampleRate = 48000,
): Promise<AudioBuffer> {
  const seconds = settings.duration / 1000
  const frames = Math.ceil((seconds + 0.05) * sampleRate)
  const ctx = new OfflineAudioContext(1, frames, sampleRate)
  scheduleWhistle(ctx, ctx.destination, settings, 0)
  return ctx.startRendering()
}
