# Dârülmülk — Tasarım Dokümanı

Konya'da, 13. yüzyılda geçen, minyatür görünümlü bir şehir yönetim oyunu. İleride
yapılacak Total War tarzı büyük oyunun **şehir katmanı** olarak tasarlanıyor; önce tek
başına oynanabilir bir oyun olarak çıkacak.

## Büyük resim

Total War'daki gibi üç katman:

1. **Kampanya haritası** — şehirler, ordular, diplomasi _(sonra)_
2. **Şehir** — bu oyun
3. **Savaş** — _(sonra)_

Şehir katmanı baştan diğer ikisine bağlanacak şekilde kuruluyor: simülasyon görüntüden
tamamen ayrı, bu yüzden açık olmayan şehirler ileride arka planda aynı hesapla işleyebilir.

## Başlangıç

**Konya, 1230'lar, Alaeddin Keykubad dönemi.** Oyuncu sultanın atadığı şehir emiri.
Şehir hazır gelir: Alaeddin Tepesi üstünde cami, kümbet ve köşk; surlar ve dört kapı;
sokaklar, mahalleler, mescitler, hamam; Meram Çayı ve çevredeki tarlalar. Amaç şehri
büyütmek, zenginleştirmek ve yaklaşan Moğol fırtınasına (1243) hazırlamak.

## Temel mekanik (sade çekirdek)

Şehir yönetimi Total War'daki kadar uğraştırır, ama oyuncu şehri gözüyle görür ve
yapıları şehrin **istediği yerine** koyar. Yol, imar, tarla ve mal zinciri yoktur.

- **Şehir iki şey üretir:** her ay vergiden **akçe** ve kendine özgü bir **ürün**. Ürün
  şehrin tanımından gelir (Konya: Sille ve Takkeli ocaklarının **taşı**; başka şehirde
  odun, demir…). Akçe her yapının bedelidir; ürün yükseltmelerin ve büyük yapıların
  malzemesidir, artanı çarşıda satılabilir.
- **Yapılar serbestçe yerleştirilir.** Su, sur, anıt, sokak ve başka yapı üstüne
  konamaz; evlerin üstüne konursa evler kalkar (halk başka yere taşınır). Ürün ocağı
  yalnızca kaynağın başına, kervansaray sur dışına kurulur.
- **Her yapının üç seviyesi vardır.** Kurmak ve yükseltmek akçe (ve çoğu zaman ürün)
  ister ve birkaç ay sürer; iş bitene dek yapı iskele içindedir, yükseltilen yapı ise
  eski seviyesinde çalışmaya devam eder. Aynı anda yürüyen inşaat sayısı şehir
  düzeyiyle sınırlıdır.
- **Nüfus, huzur ve vergi** dengeyi kurar. Vergi hanelerden gelir; ağır vergi daha çok
  akçe getirir ama huzuru düşürür. Kalabalıklaştıkça huzur azalır; cami, kışla ve hamam
  huzuru, ambar ve darüşşifa büyümeyi artırır.
- **Evler nüfustan çıkar.** Oyuncu ev kurmaz; nüfus arttıkça mahalleler sokak boylarında
  dolar, sur içi dolunca kapı yolları boyunca varoşlar büyür.
- **Zaman gerçek zamanlı, hesap aylık.** Her ayın başında gelir, ürün ve nüfus artışı
  işlenir (Total War'ın turu gibi). Oyun duraklatılabilir ve hızlandırılabilir.

### Aylık hesap

```
vergi        = nüfus × vergi oranı (hafif 0,08 · orta 0,12 · ağır 0,17 akçe/kişi)
gelir        = (vergi × (1 + medrese payı) + çarşı + kervansaray) × huzur çarpanı
ürün         = şehrin kendi payı (4) + ocaklar
nüfus artışı = nüfus × (%0,4 + ambar, hamam, darüşşifa) × huzur çarpanı
```

### Huzur

`50 + vergi etkisi (hafif +12, orta 0, ağır −15) + yapılar − kalabalık` (3.000 kişiden
sonra her 1.000 kişi için −3), 0–100 arası.

| Huzur   | Durum    | Etki                                             |
| ------- | -------- | ------------------------------------------------ |
| 65+     | Huzurlu  | Nüfus %25 daha hızlı artar                       |
| 40–65   | Sakin    | —                                                |
| 25–40   | Huzursuz | Gelir %15 düşer, nüfus artmaz                    |
| 25 altı | İsyan    | Gelir ve ürün %40 düşer, halk her ay %0,5 azalır |

### Şehir düzeyi

| Düzey       | Nüfus   | En yüksek yapı seviyesi | Aynı anda inşaat |
| ----------- | ------- | ----------------------- | ---------------- |
| Şehir       | —       | 2                       | 2                |
| Büyük Şehir | 6.000+  | 3                       | 3                |
| Payitaht    | 10.000+ | 3                       | 4                |

### Yapılar

Değerler sırasıyla 1., 2. ve 3. seviye içindir; bedeller akçe + ürün, süre ay.

| Yapı        | Boyut | Etki                                 | Bedel                            |
| ----------- | ----- | ------------------------------------ | -------------------------------- |
| Çarşı       | 3×2   | +50 / +110 / +180 akçe               | 600 · 1.200+40 · 2.200+100       |
| Taş Ocağı   | 2×2   | +20 / +40 / +70 ürün; kaynak başında | 500 · 1.000+30 · 1.800+80        |
| Cami        | 3×3   | +6 / +10 / +15 huzur                 | 900+50 · 1.600+100 · 2.600+180   |
| Hamam       | 2×2   | +3 / +5 / +8 huzur, büyümeye katkı   | 700+30 · 1.300+60 · 2.100+120    |
| Kervansaray | 3×3   | +80 / +160 / +260 akçe; sur dışında  | 1.000+60 · 1.800+100 · 3.000+180 |
| Ambar       | 2×2   | büyüme +%0,3 / +%0,5 / +%0,8         | 500 · 900+30 · 1.500+70          |
| Kışla       | 3×2   | +5 / +9 / +14 huzur; askerler        | 800+40 · 1.400+80 · 2.400+150    |
| Medrese     | 3×3   | vergi +%5 / +%10 / +%15, biraz huzur | 1.100+60 · 1.900+120 · 3.000+200 |
| Darüşşifa   | 3×2   | büyüme +%0,2 / +%0,4 / +%0,6, huzur  | 1.000+50 · 1.700+100 · 2.800+180 |

Yıkılan yapı, son seviyesinin akçe bedelinin dörtte birini geri verir. Kesin sayılar
`data/balance.json` içindedir.

### Total War bağlantısı

- Kampanya haritasında her şehir aylık akçesini hazineye, ürününü imparatorluğun ortak
  deposuna gönderir: taş kale ve köprü, demir silah, odun gemi olur.
- Huzur isyanı, nüfus asker toplama sınırını belirler; kışla garnizonu doğurur.
- Surlar, kapılar ve sokaklar kuşatma savaşında savaş alanının kendisi olur.

### Bilerek yapmadıklarımız

Yol çizme, imar, tarla çizme, üretim zincirleri ve esnaf, taşıma lojistiği, trafik,
vatandaşların tek tek takibi, hizmet menzilleri. Önceki ayrıntılı yol (imar, tarla,
esnaf, hizmetler, olaylar) git geçmişinde durur; olaylar bu çekirdeğin üstüne yeniden
eklenecek.

## Sanat yönü: minyatür

Ana tarz **minyatür**; oyuncu yakınlaştıkça sahne **gölge ve derinlik** kazanır.

- **Referanslar:** Matrakçı Nasuh'un kuşbakışı şehir resimleri; Konya'da resimlenmiş
  Selçuklu el yazması _Varka ve Gülşah_; Kubadabad Sarayı çinileri.
- **Ortografik kamera:** minyatürde kaçış noktası yoktur; sayfanın kenarındaki ev de
  ortadaki kadar büyüktür.
- **Mürekkep kontur:** her şeyin çevresi kahverengi-siyah mürekkeple çizilir. Konturlar
  geometriden değil görüntüden üretilir (derinlik, normal ve yüzey sınıfı değişimi), bu
  yüzden yeni kurulan her yapı kendiliğinden çizilir.
- **Düz renk:** ışık yok denecek kadar az; yüzler arasında yalnız hafif ton farkı.
  Yakınlaştıkça doğrudan ışık payı ve gölgeler yumuşakça gelir.
- **Desenli dolgu:** zeminde ot öbekleri ve çiçekler, suda dalga çizgileri, tarlalarda
  mevsime göre filiz, başak, anız ve saban izi.
- **İnşaat görünür:** kurulan yapı iskele, kereste ve taş yığını olarak başlar; iş
  ilerledikçe iskele içinde duvarları yükselir.
- **Halk:** sokaklar kalabalıktır. Figürler minyatürdeki gibi gerçekten biraz iridir;
  kaftanları renk renk, başlarında sarık, börk ya da örtü vardır. Sayıları nüfusla artar,
  en çok evlerin, çarşının ve caminin çevresinde dolaşırlar. Çarşıda müşteriler, cami
  kapısında cemaat, kapılarda yolcular ve askerler, ocakta taş taşıyan işçiler, tarlada
  mevsiminde çiftçiler görünür. Figürler yalnızca görüntüdür; oyun durunca onlar da durur.
- **Mevsimler (6. aşama):** yıl sahnede döner. Baharda bozkır yeşerir, meyve ağaçları
  pembe-beyaz çiçek açar; yazın ova samana döner; güzde kavaklar altın, meyve ağaçları
  pas rengi olur; kışın zemine ve düz damlara kar yağar, çiçekler kaybolur, kavaklar ve
  meyve ağaçları çıplak kalır. Karı en çok tepeler tutar; çay kıyısı ve şehrin çiğnenmiş
  toprağı daha az tutar. Tarlalar zaten mevsimle döner.
- **Parşömen:** kâğıt lifi dokusu ve kenarlara doğru eskimiş ton; ekranın çevresinde
  tezhip çerçeve (altın hat, noktalı lacivert bant, kırmızı iç hat).
- **Palet:** kerpiç okrası, tuğla kırmızısı, Selçuklu firuzesi, kobalt, kurşun mavisi,
  bozkır hakisi, altın; konturlar için mürekkep kahvesi.

## Ses (6. aşama)

Hiç ses dosyası yok; her ses WebAudio ile o anda üretilir.

- **Ortam:** kamera sokaklara indikçe şehrin uğultusu artar (nüfusla da büyür); baharda
  ve yazın kuşlar öter; kışın ve yukarıdan bakınca surların üstünde rüzgâr eser; inşaat
  sürerken iskelelerden çekiç sesi gelir. Oyun durunca uğultu kısılır.
- **İşaretler:** kurma (tahta vuruşu), yıkma (düşen taş), yükseltme (ud tınısı),
  tamamlanma (küçük çan), ay başı akçe (sikke), şehir düzeyi (yükselen çanlar), kötü haber
  (davul).
- **Müzik:** Hicaz makamında, dügâh ve nevâ dem sesi üstünde doğaçlama bir ney taksimi;
  cümleler dügâh ya da nevâda durur. Menüden kapatılır.
- Tarayıcılar sesi ancak oyuncu bir şeye dokununca başlatır; ses ilk tıkta açılır.

## Kayıt ve yükleme (6. aşama)

- Kayıt yalnızca oyunun değiştirdiklerini tutar: tarih, akçe, ürün, nüfus, vergi, yapılar
  (seviye ve süren işleriyle) ve hangi tarlaların kaldığı. Arazi, surlar, sokaklar ve
  arsalar şehrin tohumundan yeniden üretilir; kayıt küçük kalır (birkaç KB).
- **Menü:** Kaydet, Kaydı yükle, Otomatik kaydı yükle, Dosyaya indir, Dosyadan yükle,
  Müzik, Yeni oyun (iki tıkla).
- Oyun her ay başında kendini otomatik kaydeder ve açılışta kaldığı yerden devam eder.
- Başka şehrin, başka sürümün ya da bozuk bir kaydın yüklenmesi reddedilir ve nedeni
  söylenir.

## Telefon (6. aşama)

- Dokunmatikte ilk dokunuş yapının yerini ve fiyatını gösterir, aynı yere ikinci dokunuş
  kurar; yıkmak da böyledir. Parmak her şeyi kapattığı için ipucu sabit bir yerde durur.
- Dar ekranda saat ve menü üst satırda, defter onun altında iki sütun; inşa kartları
  araçların üstünde yana kayan tek sıra; bilgi paneli ekran genişliğinde.

## Teknik kararlar

- **Karo ızgarası.** Harita 200×200 karo; bir karo ≈ 10 m. Tepe ≈ 22 m yüksekliğinde.
- **Sokaklar sahnenin parçasıdır.** Şehrin tanımından ve `seed`'den üretilir, oyuncu
  değiştirmez; evler ve yürüyen halk onları izler.
- **Simülasyon görüntüden ayrı.** `src/sim/` içinde `three` kullanılmaz (ESLint kuralı);
  oyun mantığı tarayıcısız test edilir ve ileride dengeleme için ekransız koşturulur.
- **Deterministik üretim.** Aynı `seed` her zaman aynı Konya'yı üretir; ev ve ağaç
  varyasyonları karo koordinatının hash'inden gelir, komşuya bir şey yapılınca değişmez.
- **Takvim:** 30 günlük 12 ay (mevsimler tam 90 gün), Rumi ay adları. Normal hızda bir ay
  20 saniye, bir yıl 4 dakika.
- **Çizim hattı:** renk geçişi → normal+sınıf geçişi → kompozit (mürekkep, kâğıt).
  Gölge haritası yalnızca görünüm ya da şehir değişince yeniden çizilir.

## Aşamalar

Numaralar oyunun baştan beri süren sırasıdır. 1–5 arası ayrıntılı bir yol denendi; oyun
sonra daha sade bir çekirdeğe çevrildi, görüntü, şehir ve halk o yoldan kaldı. O yolun
kodu git geçmişinde durur (5. aşamanın ara kaydı `285ceb6`).

| #   | Aşama                                                                                              | Durum |
| --- | -------------------------------------------------------------------------------------------------- | ----- |
| 1   | **Zemin:** arazi, Konya'nın çekirdeği, sokaklar, kamera, zaman, minyatür görüntü                   | ✅    |
| 2   | ~~Konut imarı ve tarla çizme~~ — sade çekirdekte kalktı                                            | ↺     |
| 3   | ~~Üretim zincirleri, esnaf~~ — sade çekirdekte kalktı                                              | ↺     |
| 4   | ~~Hizmet menzilleri, bütçe, vakıf~~ — sade çekirdekte kalktı                                       | ↺     |
| 5   | ~~Olaylar ve savunma (ilk deneme)~~ — git geçmişinde; 7. ve 8. aşamada yeniden                     | ↺     |
| Ç   | **Sade çekirdek:** akçe ve şehir ürünü, serbest yerleşim, üç seviyeli yapılar, nüfus, huzur, vergi | ✅    |
| 6   | **Cila:** mevsim görünümleri, ses ve müzik, kayıt/yükleme, telefon                                 | ✅    |
| 7   | **Olaylar:** yangın, salgın, kıtlık, Moğol elçileri ve Kösedağ, bu çekirdeğe uyarlanmış            |       |
| 8   | **Savunma:** kışladan garnizon, sur bakımı, kuşatmaya hazırlık                                     |       |
| 9   | **Kampanya bağlantısı:** birden çok şehir, ürünlerin imparatorluk deposuna akışı                   |       |
