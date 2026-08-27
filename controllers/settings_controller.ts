import { Controller } from '@hotwired/stimulus'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type SoundType,
  type WhistleSettings,
} from '../services/settings-store'
import { whistle } from '../services/whistle-sound'

const BOOST_WARNING =
  'Boost zvuk výrazne zosilní a skreslí. Nepúšťaj si píšťalku pri uchu – ' +
  'môže poškodiť sluch aj reproduktor telefónu. Zapnúť?'

export default class SettingsController extends Controller<HTMLElement> {
  static override targets = [
    'frequency',
    'frequencyValue',
    'soundType',
    'duration',
    'durationValue',
    'volume',
    'volumeValue',
    'boost',
    'boostValue',
  ]

  declare readonly frequencyTarget: HTMLInputElement
  declare readonly frequencyValueTarget: HTMLElement
  declare readonly soundTypeTarget: HTMLSelectElement
  declare readonly durationTarget: HTMLInputElement
  declare readonly durationValueTarget: HTMLElement
  declare readonly volumeTarget: HTMLInputElement
  declare readonly volumeValueTarget: HTMLElement
  declare readonly boostTarget: HTMLInputElement
  declare readonly boostValueTarget: HTMLElement

  /** Potvrdenie boostu pýtame len raz za návštevu, nie pri každom posunutí. */
  private boostConfirmed = false

  override connect(): void {
    const settings = loadSettings()
    this.boostConfirmed = settings.boost > 0
    this.fill(settings)
  }

  /** Volané pri každom pohybe posuvníka – ukladáme okamžite, appka nemá „Uložiť". */
  save(): void {
    this.fill(saveSettings(this.readForm()))
  }

  /**
   * Boost sa – na rozdiel od ostatných posuvníkov – ukladá až pri pustení (`change`),
   * aby sa potvrdzovacie okno neotvorilo uprostred ťahania. Počas ťahania sa mení len popis.
   */
  previewBoost(): void {
    this.boostValueTarget.textContent = formatBoost(Number(this.boostTarget.value))
  }

  applyBoost(): void {
    if (Number(this.boostTarget.value) > 0 && !this.boostConfirmed) {
      if (confirm(BOOST_WARNING)) {
        this.boostConfirmed = true
      } else {
        this.boostTarget.value = '0'
      }
    }
    this.save()
    // Prehráme rovno ukážku – inak nie je z čoho posúdiť, koľko boostu stačí.
    if (Number(this.boostTarget.value) > 0) this.test()
  }

  /** Prehrá aktuálne nastavenie bez toho, aby sa započítalo do počítadla. */
  test(): void {
    whistle(this.readForm())
  }

  restoreDefaults(): void {
    this.boostConfirmed = false
    this.fill(saveSettings({ ...DEFAULT_SETTINGS }))
  }

  private readForm(): WhistleSettings {
    return {
      frequency: Number(this.frequencyTarget.value),
      soundType: this.soundTypeTarget.value as SoundType,
      duration: Number(this.durationTarget.value),
      volume: Number(this.volumeTarget.value),
      boost: Number(this.boostTarget.value),
    }
  }

  private fill(settings: WhistleSettings): void {
    this.frequencyTarget.value = String(settings.frequency)
    this.soundTypeTarget.value = settings.soundType
    this.durationTarget.value = String(settings.duration)
    this.volumeTarget.value = String(settings.volume)
    this.boostTarget.value = String(settings.boost)

    this.frequencyValueTarget.textContent = `${settings.frequency} Hz`
    this.durationValueTarget.textContent = `${(settings.duration / 1000)
      .toFixed(2)
      .replace('.', ',')} s`
    this.volumeValueTarget.textContent = `${Math.round(settings.volume * 100)} %`
    this.boostValueTarget.textContent = formatBoost(settings.boost)
  }
}

function formatBoost(boost: number): string {
  return boost > 0 ? `${Math.round(boost * 100)} %` : 'vypnutý'
}
