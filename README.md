# Dârülmülk

Konya'da, 13. yüzyılda geçen, **minyatür görünümlü** bir şehir yönetim oyunu. Şehir
Alaeddin Tepesi, surları, mahalleleri ve Meram Çayı ile hazır gelir; oyuncu sultanın
atadığı emir olarak onu büyütür.

Tasarım, kurallar, sanat yönü ve yol haritası: [docs/TASARIM.md](docs/TASARIM.md).

> Durum: **sade çekirdek.** Şehir her ay vergiden **akçe**, Sille ocaklarından **taş**
> üretir. Yapıları şehrin istediğin yerine koy: çarşı, taş ocağı, kervansaray, cami, hamam,
> ambar, darüşşifa, medrese, kışla. Her yapı birkaç ayda iskele içinde yükselir ve üç
> seviyeye kadar büyütülür. Vergi oranı, nüfus ve huzur dengesini gözet; şehir büyüdükçe
> Büyük Şehir ve Payitaht olur, evler kendiliğinden sur dışına taşar.

## Oynanış

| Ne        | Nasıl                                                                             |
| --------- | --------------------------------------------------------------------------------- |
| Kaydır    | Sürükle (her araçta), orta tuş, WASD / oklar, iki parmak                          |
| Döndür    | Sağ tuşla sürükle, Q / E, iki parmakla çevir                                      |
| Yakınlaş  | Tekerlek, Z / X, iki parmakla sıkıştır                                            |
| İncele    | Bir yere tıkla: bilgi paneli sabitlenir; yapının panelinden **yükselt** ya da yık |
| İnşa      | **Y** ya da araç çubuğu; çubuktan yapıyı seç, şehirde bir yere tıkla              |
| Taş ocağı | İnşa çubuğunda seçince taş yatakları zeminde turuncu görünür; ocak oraya kurulur  |
| Yık       | **B**; bir yapıya tıkla, bedelinin dörtte biri geri gelir                         |
| Vergi     | Defterde Hafif / Orta / Ağır: ağır vergi çok akçe getirir, huzuru düşürür         |
| Sat       | Defterde taşın yanında: artan taşı çarşıda akçeye çevirir                         |
| Hesap     | Defterde **Hesap**: gelirin, taşın ve huzurun dökümü                              |
| Zaman     | Boşluk: duraklat · 1 / 2 / 3: hız. Her ay başında gelir, taş ve nüfus işlenir     |

Yakınlaştıkça sahne minyatürden ışıklı bir makete döner; gölgeler belirir. Sokaklarda
halk dolaşır: çarşıda alışveriş eden, cami önünde toplanan, ocakta taş taşıyan, iskelede
çalışan, tarlada mevsiminde ekip biçen insanlar; nüfus arttıkça kalabalık da artar.

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
data/konya.json      şehrin tanımı: tepe, surlar, kapılar, çay, anıtlar, ürünü ve ocak yerleri
data/balance.json    denge sayıları: vergi, huzur, büyüme, şehir düzeyleri, yapılar ve seviyeleri
src/core/            rastgelelik, gürültü, geometri
src/sim/             oyun mantığı — three.js'ten bağımsız, Node'da test edilir
src/render/          minyatür çizim hattı, kamera, sahne görünümleri
src/ui/              tezhip çerçeve, HUD, araç çubuğu
src/game.ts          mantık, görüntü ve girdiyi birbirine bağlar
tests/               birim testleri ve tarayıcı duman testi
```
