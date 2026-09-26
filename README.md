# Dârülmülk

Konya'da, 13. yüzyılda geçen, **minyatür görünümlü** bir şehir yönetim oyunu. Şehir
Alaeddin Tepesi, surları, mahalleleri ve Meram Çayı ile hazır gelir; oyuncu sultanın
atadığı emir olarak onu büyütür.

Tasarım, kurallar, sanat yönü ve yol haritası: [docs/TASARIM.md](docs/TASARIM.md).

> Durum: **4. aşama** — hizmetler ve bütçe. Çeşme, mescit, hamam, medrese ve darüşşifa
> kur; evler hizmet aldıkça iki katlı eve ve konağa gelişir, hizmeti kesilen ev küçülür.
> Vergi oranını ve narhı seç, bakım ve sultan payını öde; parası yetmeyen yapıyı bir
> eşrafa vakıf olarak yaptır. Bilgi katmanları hangi mahallenin neyi eksik olduğunu
> gösterir. Sırada olaylar ve savunma var.

## Oynanış

| Ne         | Nasıl                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| Kaydır     | Sürükle (İncele aracında), orta tuş, WASD / oklar, iki parmak                   |
| Döndür     | Sağ tuşla sürükle, Q / E, iki parmakla çevir                                    |
| Yakınlaş   | Tekerlek, Z / X, iki parmakla sıkıştır                                          |
| İncele     | Bir karoya tıkla: bilgi paneli sabitlenir; tarlada gelecek ekim seçilir         |
| Yol        | **R** ya da araç çubuğu; iki nokta arasında sürükle. Su üstünde köprü olur      |
| Konut      | **K**; yol kenarında alan sürükle. Evler yola 2 karo yakın arsada çıkar         |
| Tarla      | **T**; verimli arazide dikdörtgen sürükle. Tarlaya bir yol değmeli              |
| Mera       | Tarla aracında **Mera**; zayıf ya da eğimli toprağa da çizilir, yün verir       |
| Yapı       | **Y**; sekmeden yapı seç, yol kenarına tıkla. Kamu yapısı **vakıf** da olabilir |
| Bütçe      | Defterde **Bütçe**: geçen ayın gelir-gideri, vergi oranı ve narh                |
| Katman     | **Katman** düğmesi: verim, hizmetler, sulama, duman ve konut katmanları         |
| Mallar     | Sağ üstteki defterde **Mallar**: depodaki mallar ve aylık artış/azalış          |
| Yık        | **B**; sürükleyerek alan seç: yol, ev, imar, tarla ve yapılar kalkar            |
| Verimlilik | **F**; verimlilik katmanını açar ya da kapar                                    |
| Zaman      | Boşluk: duraklat · 1 / 2 / 3: hız                                               |

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
data/balance.json    denge sayıları: nüfus, yiyecek, vergi, tarla, mallar, yapılar, esnaf, hizmet
src/core/            rastgelelik, gürültü, geometri
src/sim/             oyun mantığı — three.js'ten bağımsız, Node'da test edilir
src/render/          minyatür çizim hattı, kamera, sahne görünümleri
src/ui/              tezhip çerçeve, HUD, araç çubuğu
src/game.ts          mantık, görüntü ve girdiyi birbirine bağlar
tests/               birim testleri ve tarayıcı duman testi
```
