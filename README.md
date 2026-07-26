# Janissary Survivor

Yeniçeri konseptli, fantastik/mitolojik Osmanlı temalı, **Vampire Survivors**
mekaniklerine dayanan 3D tarayıcı oyunu.

> Durum: **Faz 0 tamam** — altyapı kuruldu, oyun mekaniği henüz yok.
> Plan için [ROADMAP.md](ROADMAP.md).

## Özet

- **Platform:** Web (tarayıcı), masaüstü öncelikli
- **Teknoloji:** Three.js + TypeScript + Vite
- **Görsel stil:** Prosedürel voxel (Minecraft benzeri) — modeller JSON
  tanımlardan kodla üretilir, binary asset yok
- **Kamera:** Top-down, hafif eğimli ortografik
- **MVP:** Tek harita, 15 dakikalık run, 6 silah, 8 pasif, 5 düşman tipi,
  1 boss

## Oynanış

Yeniçeri kahramanı, üzerine akan mitolojik yaratık sürülerine karşı hayatta
kalmaya çalışır. Silahlar otomatik ateşlenir; oyuncu yalnızca hareketi ve
seviye atlarken hangi yükseltmeyi alacağını kontrol eder. 15 dakika ayakta
kalmak kazanmak demektir.

## Geliştirme

Node 22 gerekir (bkz. `.nvmrc`).

```bash
npm install
npm run dev      # http://localhost:5173
```

| Komut             | Ne yapar                                        |
| ----------------- | ----------------------------------------------- |
| `npm run dev`     | Vite geliştirme sunucusu, HMR açık              |
| `npm run build`   | Tip kontrolü + üretim build'i (`dist/`)         |
| `npm run preview` | Build edilmiş çıktıyı yerelde sunar             |
| `npm test`        | Vitest birim testleri                           |
| `npm run check`   | Tip + lint + format + test — CI'ın çalıştırdığı |

`npm run check` push öncesi çalıştırılması beklenen tek komuttur; CI de aynısını
yapar.

### URL parametreleri

| Parametre  | Etki                                                            |
| ---------- | --------------------------------------------------------------- |
| `?debug=1` | Frame süresi overlay'ini açar (dev'de zaten açık)               |
| `?seed=x`  | Run'ı verilen tohumla başlatır — bir hatayı tekrar üretmek için |

## Mimari

Ayrıntılar [ROADMAP.md](ROADMAP.md) § 2'de. Günlük çalışmayı etkileyen tek
kural:

> **`src/sim/` içinde `three` import edilmez.**

Simülasyon renderer'dan bağımsız kalır ki oyun mantığı tarayıcı olmadan test
edilebilsin. Bu kural ESLint tarafından zorunlu tutulur (`no-restricted-imports`),
yani ihlal CI'da hata verir.

```
src/
  core/    saat, girdi, havuzlar, RNG — renderer'dan bağımsız
  sim/     oyun mantığı; three import ETMEZ, tamamen test edilebilir
  render/  three.js: kamera, voxel builder, efektler
  dev/     geliştirici araçları (perf overlay)
tests/     sim ve core birim testleri
```

## Lisans

Henüz belirlenmedi.
