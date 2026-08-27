# Píšťalka — PWA aplikácia pre tréning boxu

## Kontext

Prázdny repozitár. Cieľ: malá PWA aplikácia „píšťalka" pre tréning boxu — v strede veľké tlačidlo **Zapískaj**, ktoré prehrá hlasný zvuk píšťalky, nad ním počítadlo pískaní a tlačidlo **Reset**. Zvuk (typ) a frekvencia píšťalky sa dajú meniť v nastaveniach, ktoré sa ukladajú do localStorage. Aplikácia musí fungovať offline (PWA, inštalovateľná na mobil).

## Tech stack

| Oblasť | Voľba | Dôvod |
|---|---|---|
| Jazyk | TypeScript | požiadavka |
| Build | **Vite** + `vite-plugin-pwa` | ideálny pre malú appku, PWA (manifest + service worker) takmer zadarmo |
| UI framework | **Stimulus** (`@hotwired/stimulus`) | požiadavka |
| Zvuk | **Web Audio API** (syntéza, žiadne audio súbory) | frekvencia je plynule nastaviteľná, funguje offline, nulové assety |
| Testy | **Vitest** + `happy-dom` + `@tito10047/stimulus-test-utils` | test-utils sú stavané presne na Vitest 2+ / happy-dom |

## Štruktúra projektu

Zdrojáky, konfigy a TypeScript sú v **roote**. `public/` je **výstup buildu** — obsahuje len to, čo ide na web (zbuildený JS, index.html, manifest, service worker, ikony).

```
pistalka/
├── index.html                  # ZDROJOVÉ HTML (celé UI) – Vite ho pri builde spracuje do public/
├── vite.config.ts              # Vite + vite-plugin-pwa + vitest config
├── tsconfig.json
├── package.json
├── main.ts                     # bootstrap Stimulus Application, registrácia controllerov
├── style.css                   # tmavý, kontrastný „gym" vzhľad, veľké dotykové plochy
├── services/
│   ├── whistle-sound.ts        # syntéza zvuku píšťalky cez Web Audio API
│   └── settings-store.ts       # typovaný wrapper nad localStorage (nastavenia + počítadlo)
├── controllers/
│   ├── whistle_controller.ts   # tlačidlo Zapískaj, počítadlo, Reset
│   └── settings_controller.ts  # formulár nastavení, ukladanie do localStorage
├── test/                       # vitest testy
├── static/                     # zdrojové statické assety (PWA ikony 192/512/maskable)
└── public/                     # VÝSTUP BUILDU (deploy zložka): index.html, JS bundle,
                                #   manifest.webmanifest, sw.js, ikony
```

Vite config na to:
- `build.outDir: 'public'` + `emptyOutDir: true` — build ide do `public/`
- `publicDir: 'static'` — Vite defaultne berie `public/` ako zdroj statických súborov, premapujeme na `static/` (odtiaľ sa ikony kopírujú do buildu)
- `public/` pridať do `.gitignore` (generovaný artefakt), prípadne commitovať podľa spôsobu deploy-u

## Architektúra

### 1. `services/settings-store.ts` — jediný zdroj pravdy
Typovaný modul nad localStorage (kľúč napr. `pistalka.settings`, `pistalka.count`):

```ts
interface WhistleSettings {
  frequency: number;      // Hz, napr. 800–4000, default ~2800 (rozhodcovská píšťalka)
  soundType: 'classic' | 'pealess' | 'beep';  // typ zvuku
  duration: number;       // ms, default ~600
  volume: number;         // 0–1, default 1
}
```
- `loadSettings() / saveSettings()` s defaultmi a validáciou (poškodený JSON → defaulty)
- `loadCount() / saveCount()` — počítadlo prežije reload aj zabitie appky
- Žiadny stav v pamäti navyše — controllery čítajú store priamo, netreba komunikáciu medzi controllermi cez eventy.

### 2. `services/whistle-sound.ts` — syntéza píšťalky
- `AudioContext` sa vytvára/resumuje **lenivo pri prvom kliku** (autoplay policy na mobiloch vyžaduje user gesture).
- Zvuk „classic" (píšťalka s guličkou): nosný oscilátor na nastavenej frekvencii + LFO ~30–40 Hz moduluje frekvenciu/gain → typický „trilkový" zvuk rozhodcovskej píšťalky. „pealess" = čistý tón s obálkou, „beep" = square wave.
- `GainNode` obálka (rýchly attack, krátky release) — bez lupancov, maximálna hlasitosť cez `DynamicsCompressor`.
- API: `whistle(settings: WhistleSettings): void` — bezstavová funkcia, ľahko mockovateľná v testoch.

### 3. `controllers/whistle_controller.ts`
- Targets: `counter`; Actions: `blow` (tlačidlo Zapískaj), `reset`.
- `connect()`: načíta počítadlo zo store a vykreslí ho.
- `blow()`: zavolá `whistle(loadSettings())`, inkrementuje počítadlo, uloží, prerenderuje.
- `reset()`: vynuluje počítadlo + uloží.

### 4. `controllers/settings_controller.ts`
- Nastavenia v `<details>`/dialógu pod hlavným UI: slider frekvencie (s číselným zobrazením Hz), výber typu zvuku, slider dĺžky a hlasitosti.
- `connect()`: predvyplní formulár zo store. Action `save` (na `input`/`change`): okamžite uloží do localStorage.
- Tlačidlo „Vyskúšať" — prehrá zvuk s aktuálnymi hodnotami formulára.

### 5. PWA (`vite-plugin-pwa`)
- Manifest: `name: "Píšťalka"`, `display: standalone`, `theme_color` tmavá, ikony 192/512 + maskable.
- `registerType: 'autoUpdate'`, precache celého buildu → plne offline.
- Registrácia SW v `main.ts` cez `virtual:pwa-register`.

## Testy (Vitest + stimulus-test-utils)

- `vitest.config` v rámci `vite.config.ts`: `environment: 'happy-dom'`, setup súbor s `@tito10047/stimulus-test-utils/register` (auto-cleanup) + mock `AudioContext` (happy-dom ho nemá).
- `test/whistle_controller.test.ts`: cez `render(WhistleController, { html: ... })` a `user.click()` — klik inkrementuje počítadlo, viacnásobné kliky, reset vynuluje, počítadlo sa perzistuje/obnoví z localStorage, `whistle()` sa zavolá so správnymi settings (spy).
- `test/settings_controller.test.ts`: zmena slidera/selectu uloží hodnoty do localStorage; formulár sa predvyplní z uložených hodnôt.
- `test/settings-store.test.ts`: defaulty, roundtrip, poškodený JSON → defaulty.

## Postup implementácie

1. **Scaffold**: `package.json` (deps: `@hotwired/stimulus`; dev: `vite`, `typescript`, `vite-plugin-pwa`, `vitest`, `happy-dom`, `@tito10047/stimulus-test-utils`), `tsconfig.json`, `vite.config.ts` (outDir `public`, publicDir `static`), `index.html`, `main.ts`. Scripts: `dev`, `build`, `preview`, `test`.
2. **Services**: `settings-store.ts` + `whistle-sound.ts`.
3. **Controllery + UI**: `whistle_controller.ts`, `settings_controller.ts`, `index.html`, `style.css` (mobile-first, veľké tlačidlo v strede).
4. **PWA**: manifest, ikony, service worker, otestovať offline v preview.
5. **Testy**: setup + 3 testovacie súbory vyššie.

## Verifikácia

- `npm test` — všetky unit/controller testy zelené.
- `npm run build && npm run preview` — overiť: klik na Zapískaj inkrementuje počítadlo, Reset nuluje, zmena nastavení prežije reload (localStorage), manifest + SW sa registrujú (offline funkčnosť).
- Reálny zvuk overiť v prehliadači/na mobile (audio sa automatizovane testuje len cez mock).
