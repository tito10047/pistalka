import { Controller } from '@hotwired/stimulus'
import { loadCount, loadSettings, saveCount } from '../services/settings-store'
import { whistle } from '../services/whistle-sound'

/** Slovenské skloňovanie: 1 písknutie, 2–4 písknutia, 0 a 5+ pískaní. */
function countLabel(count: number): string {
  if (count === 1) return 'písknutie'
  if (count >= 2 && count <= 4) return 'písknutia'
  return 'pískaní'
}

export default class WhistleController extends Controller<HTMLElement> {
  static override targets = ['counter', 'label', 'button']

  declare readonly counterTarget: HTMLElement
  declare readonly labelTarget: HTMLElement
  declare readonly buttonTarget: HTMLButtonElement

  private count = 0

  override connect(): void {
    this.count = loadCount()
    this.render()
  }

  blow(): void {
    whistle(loadSettings())
    this.count = saveCount(this.count + 1)
    this.render()
    this.flash()
  }

  reset(): void {
    this.count = saveCount(0)
    this.render()
  }

  private render(): void {
    this.counterTarget.textContent = String(this.count)
    this.labelTarget.textContent = countLabel(this.count)
  }

  /** Krátka vizuálna odozva – v hale používateľ zvuk nemusí odlíšiť od okolia. */
  private flash(): void {
    this.buttonTarget.classList.remove('animate-whistle-pulse')
    // vynútené prekreslenie, aby sa animácia dala spustiť aj pri rýchlom klikaní
    void this.buttonTarget.offsetWidth
    this.buttonTarget.classList.add('animate-whistle-pulse')
  }
}
