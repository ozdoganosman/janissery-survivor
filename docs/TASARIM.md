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
tamamen ayrı, bu yüzden açık olmayan şehirler ileride arka planda basitleştirilmiş
hesapla işleyebilir.

## Başlangıç

**Konya, 1230'lar, Alaeddin Keykubad dönemi.** Oyuncu sultanın atadığı şehir emiri.
Şehir hazır gelir: Alaeddin Tepesi üstünde cami, kümbet ve köşk; surlar ve dört kapı;
mahalleler, mescitler, hamam; Meram Çayı ve batı yamaçlarındaki bağlar. Amaç şehri
büyütmek ve yaklaşan Moğol fırtınasına (1243) hazırlamak.

## Temel kurallar

- **Oyuncu yalnızca konut imarı verir.** Yollar çizilir, yol kenarları konut olarak
  boyanır; evler talebe göre kendiliğinden çıkar ve hizmet aldıkça gelişir.
- **Zanaat ve ticaret yalnızca çarşılarda döner.** Çarşı yapılarını (arasta, bedesten,
  han) oyuncu kurar; dükkânları esnaf, talebe ve eldeki hammaddeye göre doldurur.
- **Sanayi ve tarım devlet yatırımıdır.** İmalathaneleri oyuncu kurar; tarım,
  verimli araziye **tarla çizilerek** yapılır.

### Ekonominin akışı

```
DEVLET (oyuncu kurar)              ÇARŞI (esnaf)             KİME GİDER
Tarla  buğday ─► Değirmen  un    ─► Fırıncı  ekmek       ─► Mahalleler
Mera   yün    ─► Boyahane  iplik ─► Halıcı   halı, kumaş ─► Mahalleler, ihracat
Maden  cevher ─► Dökümhane demir ─► Demirci  alet, silah ─► Tarlalar, garnizon
```

Mahallelerdeki halk bu üç yerin hepsinde çalışan işgücüdür.

### Konut

- Konut talebini iş (tarla, imalathane, çarşıda boş yer), yiyecek ve hizmetler belirler.
- Evler kerpiç evden iki katlı eve, sonra konağa gelişir.
- Evler bir mescidin çevresinde isimli **mahalle** oluşturur.

### Tarım

- Haritada **toprak verimliliği katmanı** var; tarla verimli araziye çizilir, ekin seçilir.
- İlkbaharda ekim, yaz sonunda hasat; ürün **ambara** girer.
- **Arklar** verimi artırır; her yıl ekilen toprak yorulur, nadas gerekir.

### İmalathaneler

Değirmen, Boyahane, Dökümhane, Tabakhane, Kiremithane, Taş ocağı, Maden. Tabakhane
kokusu, dökümhane dumanı konut değerini düşürür: yerleşim kararı önemlidir.

### Çarşılar

Arasta, Bedesten, Han; dış ticaret için Kervansaray. **Narh:** muhtesib üzerinden fiyat
tavanı — halk memnun, esnaf kârı düşer.

### Kamu yatırımları

Cami/Mescit, Medrese, Hamam, Darüşşifa, Çeşme, Su yolu, İmaret, Ahi zaviyesi, Subaşı
karakolu, Sur, Burç, Kapı. Her birinin etki alanı ve bakım gideri var. **Vakıf:** yapı
hazineden ödenir ya da bir eşrafa vakıf olarak yaptırılır (hazineye yük yok, geliri
kalıcı olarak vakfa gider).

### Bütçe

- Gelir: ev vergisi, çarşı vergisi, devlet ürününün esnafa satışı, kervansaray gümrüğü.
- Gider: bakım, garnizon, sultana pay; 1243'ten sonra İlhanlı vergisi.

### Olaylar

Yangın (ahşapta yayılır, çeşme yakınında az zarar), salgın, kıtlık, deprem, Mevlana'nın
sohbetleri, Moğol elçileri, Ahi ayaklanmaları. Her olayda bir seçim.

### Total War bağlantısı

- Her şehir ya oyuncu tarafından ya da bir subaşıya bırakılarak yönetilir.
- Şehir kampanyaya gelir, erzak ve asker sağlar; ambardaki erzak ordunun yiyeceği,
  dökümhanedeki demir silahıdır.
- Kurulan sur, kapı ve sokaklar kuşatma savaşında savaş alanının kendisi olur.

### Bilerek yapmadıklarımız

Taşıma lojistiği (şehrin tek ortak deposu var), trafik simülasyonu, vatandaşların tek
tek takibi, boru/kanal ağları, RTS usulü savaş (otomatik), çok oyunculu.

## Sanat yönü: minyatür

Ana tarz **minyatür**; oyuncu yakınlaştıkça sahne **gölge ve derinlik** kazanır.

- **Referanslar:** Matrakçı Nasuh'un kuşbakışı şehir resimleri; Konya'da resimlenmiş
  Selçuklu el yazması _Varka ve Gülşah_; Kubadabad Sarayı çinileri.
- **Ortografik kamera:** minyatürde kaçış noktası yoktur; sayfanın kenarındaki ev de
  ortadaki kadar büyüktür.
- **Mürekkep kontur:** her şeyin çevresi kahverengi-siyah mürekkeple çizilir. Konturlar
  geometriden değil görüntüden üretilir (derinlik, normal ve yüzey sınıfı değişimi), bu
  yüzden yeni kurulan her yapı ve yol kendiliğinden çizilir.
- **Düz renk:** ışık yok denecek kadar az; yüzler arasında yalnız hafif ton farkı.
  Yakınlaştıkça doğrudan ışık payı ve gölgeler yumuşakça gelir.
- **Desenli dolgu:** zeminde ot öbekleri ve çiçekler, suda dalga çizgileri, ileride
  tarlalarda başak ve saban motifleri.
- **Parşömen:** kâğıt lifi dokusu ve kenarlara doğru eskimiş ton; ekranın çevresinde
  tezhip çerçeve (altın hat, noktalı lacivert bant, kırmızı iç hat).
- **Palet:** kerpiç okrası, tuğla kırmızısı, Selçuklu firuzesi, kobalt, kurşun mavisi,
  bozkır hakisi, altın; konturlar için mürekkep kahvesi.

## Teknik kararlar

- **Karo ızgarası.** Harita 200×200 karo; bir karo ≈ 10 m. Tepe ≈ 22 m yüksekliğinde.
- **Yollar 4-bağlantılı karolar**, çizimde yumuşatılır: çapraz bir sürükleme verideki
  merdiveni, ekranda düz bir çapraz yola dönüşür. Su üstündeki yol köprüdür.
- **Simülasyon görüntüden ayrı.** `src/sim/` içinde `three` kullanılmaz (ESLint kuralı);
  oyun mantığı tarayıcısız test edilir ve ileride dengeleme için ekransız koşturulur.
- **Deterministik üretim.** Aynı `seed` her zaman aynı Konya'yı üretir; ev ve ağaç
  varyasyonları karo koordinatının hash'inden gelir, komşuya bir şey yapılınca değişmez.
- **Takvim:** 30 günlük 12 ay (mevsimler tam 90 gün), Rumi ay adları. Normal hızda bir yıl
  4 dakika.
- **Çizim hattı:** renk geçişi → normal+sınıf geçişi → kompozit (mürekkep, kâğıt).
  Gölge haritası yalnızca görünüm ya da şehir değişince yeniden çizilir.

## Aşamalar

| #   | Aşama                                                                                                      | Durum |
| --- | ---------------------------------------------------------------------------------------------------------- | ----- |
| 1   | **Zemin:** arazi, verimlilik haritası, Konya'nın mevcut çekirdeği, yollar, kamera, zaman, minyatür görüntü | ✅    |
| 2   | **Konut ve tarım:** konut imarı, nüfus, tarla çizme, hasat, ambar — ilk oynanabilir döngü                  | ⏳    |
| 3   | **Üretim ve çarşı:** imalathaneler, çarşılar, esnaf, üretim zincirleri                                     |       |
| 4   | **Hizmetler ve bütçe:** kamu yapıları, etki alanları, bilgi katmanları, vergi, vakıf                       |       |
| 5   | **Olaylar ve savunma:** yangın, salgın, kıtlık, Moğol elçileri, sur, garnizon                              |       |
| 6   | **Cila:** mevsim görünümleri, ses, kayıt/yükleme, telefon                                                  |       |
