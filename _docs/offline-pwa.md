# Offline režim (service worker) — ako to funguje a čo dobudovať

Cieľ: appka musí bežať bez internetu (letecký režim v telocvični) a po pripojení sa sama
aktualizovať. Prioritná platforma je **Safari na iPhone**.

Tento dokument popisuje, ako to celé drží pokope (časť A) a čo sme dorobili špeciálne
kvôli iOS (časť B). Všetko popísané je **nasadené**.

---

## A. Súčasný stav — čo už funguje

### Generovanie service workera

- `vite.config.ts` → plugin `VitePWA` v režime **generateSW**: Workbox pri `npm run build`
  vygeneruje `public/sw.js` + `public/workbox-*.js`. My žiadny SW súbor ručne nepíšeme.
- `workbox.globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}']` — všetko z buildu sa
  **precachne pri inštalácii SW**. Od druhého načítania beží appka kompletne z Cache Storage.
- Plugin má default `navigateFallback: 'index.html'` — každá navigácia offline dostane
  appku, aj keby URL nesedela presne.
- Appka nemá **žiadne runtime požiadavky**: zvuk sa syntetizuje cez Web Audio API
  (`services/whistle-sound.ts`), nastavenia sú v localStorage. Preto stačí čistý precache
  a netreba žiadne runtime caching stratégie (NetworkFirst a pod.).

### Registrácia a aktualizácia

- `services/pwa-update.ts` → `registerSW({ immediate: true })` z `virtual:pwa-register`,
  volané z `main.ts` cez `registerServiceWorker()`.
- `registerType: 'autoUpdate'`: nový SW dostane `skipWaiting` + `clientsClaim`, takže po
  stiahnutí sa okamžite aktivuje a otvorené okná sa reloadnú na novú verziu. Žiadny
  „k dispozícii je nová verzia" prompt — pre takúto jednoduchú appku je to správne.
- Priebeh aktualizácie: prehliadač pri načítaní stránky porovná `sw.js` bajt po bajte →
  ak sa líši, nainštaluje nový SW, Workbox na pozadí stiahne len zmenené assety
  (revízie v precache manifeste), prepne a reloadne.

### Server (Apache) — podmienka, aby sa aktualizácie vôbec šírili

Vhost v `deploy.sh` nastavuje:

- `Cache-Control: no-cache, must-revalidate` pre `sw.js`, `index.html`,
  `manifest.webmanifest`, `registerSW.js` — bez toho by si prehliadač držal starý `sw.js`
  a nikto by novú verziu nedostal.
- `Cache-Control: public, max-age=31536000, immutable` pre `/assets/` — súbory majú hash
  v názve, môžu sa cachovať navždy.

Toto je krehké miesto: **ak sa niekedy zmení zoznam necachovaných súborov (napr. nový
entry point), treba upraviť vhost** (`deploy.sh --setup`).

### Testy

- `tests/pwa.spec.ts`: počká na `navigator.serviceWorker.controller`, prepne
  `context.setOffline(true)`, reloadne a overí, že appka žije **a že naozaj píska**
  (cez `renderWhistleOffline()` — vykreslený panel sám o sebe nič nedokazuje).
  Beží proti reálnemu buildu (`playwright.config.ts` spúšťa `npm run build && vite preview`),
  inak by SW nešiel overiť.

---

## B. Čo sme dorobili kvôli iPhonu (Safari)

### 1. Periodická kontrola aktualizácie — najdôležitejšie

Problém: kontrola nového `sw.js` sa inak deje len pri **načítaní stránky**. Appka pridaná
na plochu iPhonu sa ale reálne nenačítava — iOS ju drží zamrznutú v pamäti aj celé dni.
Používateľ by tak mohol mesiace bežať na starej verzii.

Riešenie v `services/pwa-update.ts` (callback `onRegisteredSW`):

- `setInterval` raz za hodinu zavolá `registration.update()`,
- navyše kontrola pri `visibilitychange` → `visible`, čo je na iOS **jediný spoľahlivý
  moment**, kedy sa kód po návrate z pozadia znova rozbehne,
- pred `update()` sa `fetch`om overí, že server žije; offline sa kontrola ticho preskočí,
  nech konzola nezbiera chyby.

Recept: https://vite-pwa-org.netlify.app/guide/periodic-sw-updates

### 2. Apple meta tagy v `index.html`

Doplnené vedľa štandardného `mobile-web-app-capable` (staršie iOS pozná len prefixované):

- `apple-mobile-web-app-capable` — beh na celú obrazovku po pridaní na plochu,
- `apple-mobile-web-app-status-bar-style` = `black-translucent` (sedí k tmavému dizajnu,
  `viewport-fit=cover` + safe-area padding už v layoute boli),
- `apple-mobile-web-app-title` = „Píšťalka" — názov pod ikonou.

### 3. Dedikovaná ikona `apple-touch-icon` 180×180

Predtým sa používala `icons/icon-192.png`, ktorá má **biele rohy** — `favicon.svg` má
zaoblené rohy (`rx="112"`) a Playwright priehľadnosť pri screenshote podkladá bielou.
iOS si ikonu maskuje do squircle sám, takže okolo tmavého štvorca svietil biely lem.

Riešenie: `scripts/generate-icons.mjs` má nový voliteľný parameter `background`. Pre
`static/icons/apple-touch-icon.png` (180×180) sa `favicon.svg` renderuje na pozadí
**tej istej farby**, akú má jeho vlastný podklad (`#0b1220`) — zaoblené rohy tak splynú
a vznikne plný nepriehľadný štvorec. Žiadna tretia kópia kresby nebola potrebná.

Ostatné ikony sa nezmenili (`background` je pri nich `transparent`, čo zodpovedá
pôvodnému správaniu). Generuje sa cez `npm run icons`, do buildu ide cez `publicDir: 'static'`.

> Poznámka: `icon-192.png`/`icon-512.png` v manifeste majú stále biele rohy. Na Androide
> sa používa maskable varianta, takže to nevadí — ak by prekážalo, stačí im nastaviť
> `background: '#0b1220'` v generátore.

### 4. 7-dňová evikcia úložiska (ITP) — vedieť o nej, netreba nič kódiť

Safari maže **všetko úložisko webu** (Cache Storage, localStorage…), ak používateľ stránku
7 dní nepoužil — ale **len pre web otvorený v Safari tabe**. Pre appku **pridanú na plochu
sa evikcia neuplatňuje.**

Dôsledok: „Pridať na plochu" nie je len kozmetika, je to technická poistka offline režimu
aj uložených nastavení. Námet (voliteľné, nie teraz): jemný jednorazový hint v UI pre
iOS používateľov v Safari, že appku si môžu pridať na plochu.

Zdroj: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/

### 5. Obmedzenia iOS, ktoré nás netrápia

- **Background Sync / Periodic Background Sync** na iOS neexistuje — nevadí, appka nič
  nesynchronizuje; periodickú kontrolu z bodu 1 robíme, len kým appka beží.
- **Limity Cache Storage** (rádovo desiatky MB) — celý build má pár stoviek kB, rezerva
  je obrovská.
- **Push notifikácie** — nepoužívame.

---

## C. Manuálny test na iPhone — checklist

1. Otvoriť https://pistalka.vsetkosada.sk v Safari, chvíľu počkať (inštalácia SW).
2. Zdieľať → **Pridať na plochu** → spustiť z plochy (celá obrazovka, bez Safari UI).
3. Zapnúť **letecký režim** → appka sa musí spustiť a pískať (zvuk je syntetizovaný,
   žiadne sťahovanie).
4. Overiť, že nastavenia (posuvníky) zostali zachované.
5. Test aktualizácie: nasadiť zmenu cez `./deploy.sh`, pripojiť telefón, appku zavrieť
   a otvoriť (prípadne počkať na periodickú kontrolu z bodu B.1) → nová verzia.

## D. Automatické testy

`tests/pwa.spec.ts` pokrýva:

- platný manifest a dostupnosť všetkých ikon z neho,
- registráciu service workera a beh offline vrátane **overenia zvuku** cez
  `window.pistalka.renderWhistleOffline()` (test spadne aj vtedy, keď sa stránka
  vykreslí, ale píšťalka je ticho),
- test „appka je pripravená na pridanie na plochu iPhonu" — Apple meta tagy a to, že
  `apple-touch-icon` má `sizes="180x180"` a naozaj sa dá stiahnuť.

Limit: Playwright WebKit je blízko Safari, ale nie je to reálny iOS — checklist C
zostáva jediný skutočný test na iPhone.

## E. Dokumentácia

- vite-plugin-pwa (guide, register, workbox): https://vite-pwa-org.netlify.app/
- Periodické SW aktualizácie: https://vite-pwa-org.netlify.app/guide/periodic-sw-updates
- Workbox (generateSW, precaching): https://developer.chrome.com/docs/workbox
- Service Worker API (MDN): https://developer.mozilla.org/docs/Web/API/Service_Worker_API
- PWA kurz (web.dev): https://web.dev/learn/pwa
- WebKit ITP / 7-dňová evikcia: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- Apple — Configuring Web Applications: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
