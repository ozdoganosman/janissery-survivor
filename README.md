# Dârülmülk

Konya'da, 13. yüzyılda geçen, **minyatür görünümlü** bir şehir yönetim oyunu. Şehir
Alaeddin Tepesi, surları, mahalleleri ve Meram Çayı ile hazır gelir; oyuncu sultanın
atadığı emir olarak onu büyütür.

Tasarım, kurallar, sanat yönü ve yol haritası: [docs/TASARIM.md](docs/TASARIM.md).

> Durum: **2. aşama** — ilk oynanabilir döngü. Konut arsası ayır, evler talebe göre
> kendiliğinden yükselsin; verimli toprağa tarla çiz, buğday ya da arpa ek, Ağustos'ta
> hasadı ambara al. Ambar biterse kıtlık başlar. Sırada imalathaneler ve çarşılar var.

## Oynanış

| Ne         | Nasıl                                                                      |
| ---------- | -------------------------------------------------------------------------- |
| Kaydır     | Sürükle (İncele aracında), orta tuş, WASD / oklar, iki parmak              |
| Döndür     | Sağ tuşla sürükle, Q / E, iki parmakla çevir                               |
| Yakınlaş   | Tekerlek, Z / X, iki parmakla sıkıştır                                     |
| İncele     | Bir karoya tıkla: bilgi paneli sabitlenir; tarlada gelecek ekim seçilir    |
| Yol        | **R** ya da araç çubuğu; iki nokta arasında sürükle. Su üstünde köprü olur |
| Konut      | **K**; yol kenarında alan sürükle. Evler yola 2 karo yakın arsada çıkar    |
| Tarla      | **T**; verimli arazide dikdörtgen sürükle. Tarlaya bir yol değmeli         |
| Yık        | **B**; sürükleyerek alan seç: yol, ev, imar ve tarlalar kalkar             |
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
data/balance.json    denge sayıları: nüfus, yiyecek, vergi, tarla, talep
src/core/            rastgelelik, gürültü, geometri
src/sim/             oyun mantığı — three.js'ten bağımsız, Node'da test edilir
src/render/          minyatür çizim hattı, kamera, sahne görünümleri
src/ui/              tezhip çerçeve, HUD, araç çubuğu
src/game.ts          mantık, görüntü ve girdiyi birbirine bağlar
tests/               birim testleri ve tarayıcı duman testi
```
