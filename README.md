# Píšťalka

PWA píšťalka pre tréning boxu. Veľké tlačidlo **Zapískaj** prehrá zvuk píšťalky, nad ním beží
počítadlo pískaní. Zvuk sa syntetizuje cez Web Audio API, takže sa dá plynule meniť frekvencia,
typ, dĺžka aj hlasitosť. Nastavenia aj počítadlo sa ukladajú do `localStorage` a aplikácia funguje
offline.

## Spustenie

```bash
npm install
npm run dev        # vývojový server
npm run build      # produkčný build do public/
npm run preview    # náhľad produkčného buildu
npm test           # Playwright testy (desktop + mobil)
npm run icons      # pregeneruje PNG ikony zo SVG predlôh
```

## Štruktúra

Zdrojové súbory sú v roote, `public/` je **výstup buildu** – práve tento priečinok sa nasadzuje.

```
index.html              zdrojové HTML s celým UI
main.ts                 bootstrap Stimulusu + registrácia service workera
style.css               Tailwind CSS v4 (+ vlastný `slider` utility a animácia)
services/
  settings-store.ts     typovaný wrapper nad localStorage, defaulty a validácia
  whistle-sound.ts      syntéza zvuku cez Web Audio API
controllers/
  whistle_controller.ts počítadlo, tlačidlo Zapískaj, reset
  settings_controller.ts formulár nastavení
static/                 zdrojové statické assety (ikony) – kopírujú sa do buildu
scripts/                generátor PNG ikon
tests/                  Playwright testy
public/                 VÝSTUP BUILDU (v .gitignore)
```

## Zvuk

`services/whistle-sound.ts` skladá zvuk z oscilátorov, nie zo samplov – nepotrebuje žiadne
audio súbory a frekvencia je spojito nastaviteľná.

- **Klasická (s guličkou)** – nosný tón, kvinta a oktáva, plus LFO ~31 Hz, ktoré moduluje výšku
  aj hlasitosť. To je ten typický trilkujúci zvuk rozhodcovskej píšťalky. Pridaný je aj filtrovaný
  šum, bez ktorého znie výsledok príliš „syntetizátorovo".
- **Bezguličková (Fox 40)** – dva blízke tóny, ktoré spolu ostro „režú".
- **Pípnutie** – filtrovaná obdĺžniková vlna.

`AudioContext` sa vytvára až pri prvom dotyku obrazovky – prehliadače inak zvuk blokujú.

## Testy

Testuje sa cez Playwright proti reálnemu produkčnému buildu (`playwright.config.ts` si build aj
preview server spustí sám), v profile `desktop` aj `mobil`.

| Súbor | Čo overuje |
|---|---|
| `tests/whistle.spec.ts` | počítadlo, skloňovanie, reset, perzistencia, odolnosť voči poškodeným dátam |
| `tests/settings.spec.ts` | predvyplnenie formulára, okamžité ukladanie, tlačidlá Vyskúšať a Predvolené |
| `tests/sound.spec.ts` | že zvuk naozaj znie – renderuje sa cez `OfflineAudioContext` a analyzujú sa vzorky |
| `tests/pwa.spec.ts` | manifest, dostupnosť ikon, registrácia service workera a chod offline |

Aplikácia vystavuje ladiace API `window.pistalka` (`whistle`, `renderWhistleOffline`), cez ktoré
testy aj konzola prehliadača vedia zvuk vyrenderovať a zmerať.

## Nasadenie

Po `npm run build` nahraj obsah `public/` na web server. Ak server ukazuje priamo na tento
checkout, zakomentuj riadok `public/` v `.gitignore` a priečinok commitni.
