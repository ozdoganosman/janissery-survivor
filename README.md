# Dârülmülk

Konya'da, 13. yüzyılda geçen, **minyatür görünümlü** bir şehir yönetim oyunu. Şehir
Alaeddin Tepesi, surları, mahalleleri ve Meram Çayı ile hazır gelir; oyuncu sultanın
atadığı emir olarak onu büyütür.

Tasarım, kurallar, sanat yönü ve yol haritası: [docs/TASARIM.md](docs/TASARIM.md).

> Durum: **8. aşama — ordu.** Sur dışındaki büyük kışla, seviyesiyle ordugâhtan kaleye
> büyür ve bölük bölük asker toplar: mızraklı yaya, yaya okçu, Türkmen atlı okçusu, gulam
> süvarisi. Her er kışlada tek tek görünür; talimde mızrakçılar hamle yapar, okçular
> hedefe ok atar, atlılar meydanın çevresinde dörtnala döner. Askerler eklemli, savaşa
> hazır figürlerdir. Şehir her ay vergiden **akçe**, Sille ocaklarından **taş** üretir;
> yapıları istediğin yere koyar, üç seviyeye kadar büyütürsün. **Yapı hakkı**, **bakım**,
> **erzak**, **ulufe** ve borç büyümeyi sınırlar. Şehir büyüdükçe **yeni sur halkaları**
> ve varoş sokakları açılır. Yıl sahnede döner; şehrin sesi ve Hicaz makamında bir ney
> eşlik eder. Oyun her ay kendini kaydeder. Telefonda da oynanır.

## Oynanış

| Ne        | Nasıl                                                                                      |
| --------- | ------------------------------------------------------------------------------------------ |
| Kaydır    | Sürükle (her araçta), orta tuş, WASD / oklar, iki parmak                                   |
| Döndür    | Sağ tuşla sürükle, Q / E, iki parmakla çevir                                               |
| Yakınlaş  | Tekerlek, Z / X, iki parmakla sıkıştır                                                     |
| İncele    | Bir yere tıkla: bilgi paneli sabitlenir; yapının panelinden **yükselt** ya da yık          |
| Rozetler  | Yapının üstünde seviyesi; nabız atan rozet yükseltilebilir demek. Tıkla, yapıya gider      |
| Yapılar   | **L** ya da araç çubuğu: bütün yapılar, sıradaki basamak, eksikler, yapı hakkı             |
| İnşa      | **Y** ya da araç çubuğu; çubuktan yapıyı seç, şehirde bir yere tıkla. Kart eksiği yazar    |
| Taş ocağı | İnşa çubuğunda seçince taş yatakları zeminde turuncu görünür; ocak oraya kurulur           |
| Yık       | **B**; bir yapıya tıkla, bedelinin dörtte biri geri gelir                                  |
| Vergi     | Defterde Hafif / Orta / Ağır: ağır vergi çok akçe getirir, huzuru düşürür                  |
| Sat       | Defterde taşın yanında: artan taşı çarşıda akçeye çevirir                                  |
| Hesap     | Defterde **Hesap**: gelir ve bakım, taş, erzak, huzurun kalem kalem dökümü                 |
| Sur       | Yapılar listesinin başında: Büyük Şehir olunca Dış Sur, Payitaht olunca Varoş Suru         |
| Ordu      | Kışlayı sur dışına kur, panelinden bölük topla ya da terhis et; askerler kışlada saf tutar |
| Zaman     | Boşluk: duraklat · 1 / 2 / 3: hız. Her ay başında gelir, taş ve nüfus işlenir              |
| Ses       | Saatin yanındaki hoparlör: sesi açar ya da kapar. İlk tıkta başlar                         |
| Menü      | ☰: kaydet, yükle, otomatik kayıt, dosyaya indir / dosyadan yükle, müzik, yeni oyun        |
| Telefon   | İlk dokunuş yapının yerini ve fiyatını gösterir, ikinci dokunuş kurar ya da yıkar          |

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
data/konya.json      şehrin tanımı: tepe, surlar, kapılar, çay, anıtlar, ürünü, ocak yerleri,
                     sonraki sur halkaları ve varoş sokakları
data/balance.json    denge sayıları: vergi, huzur, erzak, borç, şehir düzeyleri, yapılar,
                     seviyeleri, bakımları ve sınırları
src/core/            rastgelelik, gürültü, geometri
src/sim/             oyun mantığı — three.js'ten bağımsız, Node'da test edilir
src/render/          minyatür çizim hattı, kamera, sahne görünümleri
src/ui/              tezhip çerçeve, HUD, araç çubuğu, menü
src/audio/           WebAudio ile üretilen sesler ve ney
src/game.ts          mantık, görüntü ve girdiyi birbirine bağlar
tests/               birim testleri ve tarayıcı duman testi
```
