import './style.css'
import { Application } from '@hotwired/stimulus'
import { registerServiceWorker } from './services/pwa-update'
import WhistleController from './controllers/whistle_controller'
import SettingsController from './controllers/settings_controller'
import { renderWhistleOffline, unlockAudio, whistle } from './services/whistle-sound'

const application = Application.start()
application.register('whistle', WhistleController)
application.register('settings', SettingsController)

// Ladiace API – umožňuje z konzoly aj z testov overiť, ako zvuk naozaj znie.
declare global {
  interface Window {
    pistalka: { whistle: typeof whistle; renderWhistleOffline: typeof renderWhistleOffline }
  }
}
window.pistalka = { whistle, renderWhistleOffline }

// Prvý dotyk odomkne audio, aby úvodné písknutie nemalo oneskorenie.
window.addEventListener('pointerdown', unlockAudio, { once: true })

registerServiceWorker()
