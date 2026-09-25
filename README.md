# Dârülmülk

Konya'da, 13. yüzyılda geçen, **minyatür görünümlü** bir şehir yönetim oyunu. Şehir
Alaeddin Tepesi, surları, mahalleleri ve Meram Çayı ile hazır gelir; oyuncu sultanın
atadığı emir olarak onu büyütür.

Tasarım, kurallar, sanat yönü ve yol haritası: [docs/TASARIM.md](docs/TASARIM.md).

> Durum: **1. aşama** — arazi, verimlilik haritası, Konya'nın çekirdeği, yol yapımı,
> kamera, zaman ve minyatür görüntü. Konut imarı ve tarım 2. aşamada.

## Oynanış

| Ne         | Nasıl                                                                      |
| ---------- | -------------------------------------------------------------------------- |
| Kaydır     | Sürükle (İncele aracında), orta tuş, WASD / oklar, iki parmak              |
| Döndür     | Sağ tuşla sürükle, Q / E, iki parmakla çevir                               |
| Yakınlaş   | Tekerlek, Z / X, iki parmakla sıkıştır                                     |
| Yol        | **R** ya da araç çubuğu; iki nokta arasında sürükle. Su üstünde köprü olur |
| Yık        | **B**; sürükleyerek alan seç, içindeki yollar kalkar                       |
| Verimlilik | **F**; tarla için toprağın ne kadar iyi olduğunu gösterir                  |
| Zaman      | Boşluk: duraklat · 1 / 2 / 3: hız                                          |

Yakınlaştıkça sahne minyatürden ışıklı bir makete döner; gölgeler belirir.

## Geliştirme

```bash
npm install
npm run dev        # geliştirme sunucusu
npm run check      # tip denetimi, lint, biçim, birim testleri
npm run build      # dist/
npm run test:e2e   # derlenmiş oyunu tarayıcıda açıp oynayan duman testi
```

Önceden kurulu bir Chromium kullanmak için: `CHROMIUM_PATH=/yol/chrome npm run test:e2e`.

## Yapı

```
data/konya.json      şehrin tanımı: tepe, surlar, kapılar, çay, anıtlar
src/core/            rastgelelik, gürültü, geometri
src/sim/             oyun mantığı — three.js'ten bağımsız, Node'da test edilir
src/render/          minyatür çizim hattı, kamera, sahne görünümleri
src/ui/              tezhip çerçeve, HUD, araç çubuğu
src/game.ts          mantık, görüntü ve girdiyi birbirine bağlar
tests/               birim testleri ve tarayıcı duman testi
```
