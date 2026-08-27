import { Controller } from '@hotwired/stimulus'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type SoundType,
  type WhistleSettings,
} from '../services/settings-store'
import { whistle } from '../services/whistle-sound'

export default class SettingsController extends Controller<HTMLElement> {
  static override targets = [
    'frequency',
    'frequencyValue',
    'soundType',
    'duration',
    'durationValue',
    'volume',
    'volumeValue',
  ]

  declare readonly frequencyTarget: HTMLInputElement
  declare readonly frequencyValueTarget: HTMLElement
  declare readonly soundTypeTarget: HTMLSelectElement
  declare readonly durationTarget: HTMLInputElement
  declare readonly durationValueTarget: HTMLElement
  declare readonly volumeTarget: HTMLInputElement
  declare readonly volumeValueTarget: HTMLElement

  override connect(): void {
    this.fill(loadSettings())
  }

  /** Volané pri každom pohybe posuvníka – ukladáme okamžite, appka nemá „Uložiť". */
  save(): void {
    this.fill(saveSettings(this.readForm()))
  }

  /** Prehrá aktuálne nastavenie bez toho, aby sa započítalo do počítadla. */
  test(): void {
    whistle(this.readForm())
  }

  restoreDefaults(): void {
    this.fill(saveSettings({ ...DEFAULT_SETTINGS }))
  }

  private readForm(): WhistleSettings {
    return {
      frequency: Number(this.frequencyTarget.value),
      soundType: this.soundTypeTarget.value as SoundType,
      duration: Number(this.durationTarget.value),
      volume: Number(this.volumeTarget.value),
    }
  }

  private fill(settings: WhistleSettings): void {
    this.frequencyTarget.value = String(settings.frequency)
    this.soundTypeTarget.value = settings.soundType
    this.durationTarget.value = String(settings.duration)
    this.volumeTarget.value = String(settings.volume)

    this.frequencyValueTarget.textContent = `${settings.frequency} Hz`
    this.durationValueTarget.textContent = `${(settings.duration / 1000)
      .toFixed(2)
      .replace('.', ',')} s`
    this.volumeValueTarget.textContent = `${Math.round(settings.volume * 100)} %`
  }
}
