import { registerSW } from 'virtual:pwa-register'

/**
 * Kontrola novej verzie sa inak deje len pri načítaní stránky. Appka pridaná na plochu
 * iPhonu sa ale nenačítava – iOS ju drží zamrznutú v pamäti aj celé dni, takže by na
 * starej verzii bežala donekonečna. Preto kontrolujeme aj sami.
 */
const CHECK_INTERVAL = 60 * 60 * 1000

export function registerServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration) return

      const check = async () => {
        if (registration.installing || !navigator.onLine) return
        try {
          // Sieťou overíme, či server vôbec žije; `registration.update()` by inak
          // pri výpadku zbytočne hádzal chyby do konzoly.
          const response = await fetch(swUrl, {
            cache: 'no-store',
            headers: { 'cache-control': 'no-cache' },
          })
          if (response.status === 200) await registration.update()
        } catch {
          // offline alebo nedostupný server – skúsime nabudúce
        }
      }

      setInterval(check, CHECK_INTERVAL)
      // Návrat appky z pozadia je na iOS jediný spoľahlivý moment, kedy kód znova beží.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check()
      })
    },
  })
}
