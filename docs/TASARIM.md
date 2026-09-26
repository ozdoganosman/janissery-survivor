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
- **İnşaat sınırsız değildir.** Şehrin bir **yapı hakkı** vardır (Şehir 5, Büyük Şehir 8,
  Payitaht 12; her yeni sur halkası birkaç hak daha verir) ve her yapı türünden en çok
  bir ya da iki tane kurulur. Hak dolunca büyümenin yolu yeni yapı değil, eldekini
  yükseltmek ya da yıkıp yerine başkasını kurmaktır.
- **Her yapının aylık bakımı vardır** ve seviyeyle artar. Akçe eksiye düşerse borç
  huzuru bozar; ama yapılar kapanmaz, emir borcu kapatmanın yolunu bulmalıdır.
- **Nüfus, huzur ve vergi** dengeyi kurar. Vergi hanelerden gelir; ağır vergi daha çok
  akçe getirir ama huzuru düşürür. Kalabalıklaştıkça huzur azalır; cami, kışla ve hamam
  huzuru, ambar ve darüşşifa büyümeyi artırır.
- **Şehir doyurabildiği kadar büyür.** Erzak sınırı şehrin payından, çevresinde hâlâ
  ekilen tarlalardan ve ambarlardan gelir. Nüfus sınıra yaklaştıkça artış yavaşlar;
  sınırı aşarsa halk aç kalır, huzur düşer ve göç başlar. Varoşlar büyüdükçe tarlaları
  yer, bu yüzden büyüyen şehir ambarsız kalamaz.
- **Evler nüfustan çıkar.** Oyuncu ev kurmaz; nüfus arttıkça mahalleler sokak boylarında
  dolar, sur içi dolunca kapı yolları boyunca varoşlar büyür. Şehir düzeyi yükseldikçe
  evler kalabalıklaşır: haritadaki her ev bir ev adasıdır, içinde birkaç hane oturur (ada
  başına 70, 90, 110 kişi).
- **Şehir büyüdükçe yeni surlar ve sokaklar açılır** (aşağıda _Surlar ve sokaklar_).
- **Zaman gerçek zamanlı, hesap aylık.** Her ayın başında gelir, ürün ve nüfus artışı
  işlenir (Total War'ın turu gibi). Oyun duraklatılabilir ve hızlandırılabilir.

### Aylık hesap

```
vergi        = nüfus × vergi oranı (hafif 0,06 · orta 0,09 · ağır 0,13 akçe/kişi)
gelir        = (vergi × (1 + medrese payı) + çarşı + kervansaray) × huzur çarpanı − bakım
ürün         = şehrin kendi payı (40) + ocaklar
erzak sınırı = 25.000 + ekili tarla karosu × 30 + ambarlar
nüfus artışı = nüfus × (%0,3 + ambar, hamam, darüşşifa) × huzur çarpanı
               × en çok 1, (1 − nüfus / erzak sınırı) × 4
açlık        = nüfus erzak sınırını aştıysa her ay aşımın %40'ı kadar halk göçer
```

Konya 42.000 kişi, 30.000 akçe ve 600 araba taşla, Larende Çarşısı ve Meram Ambarı kurulu
olarak başlar.

### Huzur

`50 + vergi etkisi (hafif +10, orta 0, ağır −15) + yapılar + surlar − kalabalık − açlık −
borç`, 0–100 arası.

- **Kalabalık:** 30.000 kişiden sonra her 10.000 kişi için −4.
- **Surlar:** her yeni sur halkası +5.
- **Açlık:** nüfus erzak sınırını her %10 aştıkça −6.
- **Borç:** hazine eksideyken −15.

Defterdeki **Hesap** bu kalemlerin her birini ayrı gösterir.

| Huzur   | Durum    | Etki                                             |
| ------- | -------- | ------------------------------------------------ |
| 65+     | Huzurlu  | Nüfus %25 daha hızlı artar                       |
| 40–65   | Sakin    | —                                                |
| 25–40   | Huzursuz | Gelir %15 düşer, nüfus artmaz                    |
| 25 altı | İsyan    | Gelir ve ürün %40 düşer, halk her ay %0,5 azalır |

### Şehir düzeyi

| Düzey       | Nüfus    | En yüksek yapı seviyesi | Aynı anda inşaat | Yapı hakkı | Ada başına |
| ----------- | -------- | ----------------------- | ---------------- | ---------- | ---------- |
| Şehir       | —        | 2                       | 2                | 5          | 70         |
| Büyük Şehir | 60.000+  | 3                       | 3                | 8          | 90         |
| Payitaht    | 100.000+ | 3                       | 4                | 12         | 110        |

Bir düzeye varan şehir onu, nüfusu eşiğin %10 altına inene dek korur (Büyük Şehir 54.000,
Payitaht 90.000). Kıtlıkta birkaç aile eksilen şehir her ay düzey kazanıp kaybetmez;
ustaları, yapı hakkı ve yapı seviyeleri birden daralmaz. Hesap dökümü sınırı yazar.

### Tarihî ölçek

Sayılar 13. yüzyıl Konya'sına göre ayarlıdır:

- **Nüfus.** Sultan I. Alâeddin Keykubad dönemi sonrasında Konya'nın en kalabalık hâli
  için tahminler 45–50 bin, iyimser hesapla 60 bin kişidir (yedi cuma camisi × cami başına
  ≈2.000 kişi; nüfusun ≈%10'u gayrimüslim). Oyun 1230'da 42.000 kişiyle başlar; Büyük Şehir
  eşiği 60.000 tarihî zirvedir, Payitaht (100.000) tarihin ötesine geçmek demektir.
- **Surlar.** 1221'de tamamlanan sur ≈10.000 adım uzunluğunda, 12 kapılı ve 108 burçluydu
  (Texier); önünde 15 m genişliğinde hendek vardı.
- **Ordu.** Sultanın hassa ordusu ≈4.000 kişiydi, bunun 1.000'i doğrudan sultanın
  emrindeki gulamlardı (gulâmân-ı hassa). 1230 Yassıçemen'de Selçuklu tarafında 20.000'i
  aşkın asker vardı; 1243 Kösedağ için bugünkü tahminler 60–80 bindir. Birlikler 50'lik
  (visak başı) ve 100'lük (hayl başı) düzende sayılır. Kışlanın 2.000 / 5.000 / 10.000
  kişilik yeri hassa ordusundan bir sefer ordusunun çekirdeğine uzanır.

Kaynaklar: TDV İslâm Ansiklopedisi, "Konya" ve "Hassa Ordusu" maddeleri
(islamansiklopedisi.org.tr); "Battle of Köse Dağ" ve "Battle of Yassıçemen"
(Wikipedia); Konyapedia, "Konya Kalesi"; "Anadolu Selçukluları Döneminde Yerleşme ve
Nüfus" (academia.edu).

### Yapılar

Değerler sırasıyla 1., 2. ve 3. seviye içindir; bedeller akçe + ürün, bakım aylık akçe.

| Yapı        | En çok | Etki                                                                | Bedel                                    | Bakım           |
| ----------- | ------ | ------------------------------------------------------------------- | ---------------------------------------- | --------------- |
| Çarşı       | 2      | +500 / +1.100 / +1.800 akçe                                         | 6.000 · 12.000+400 · 22.000+1.000        | 50 / 100 / 160  |
| Taş Ocağı   | 2      | +200 / +400 / +700 ürün; kaynak başında                             | 5.000 · 10.000+300 · 18.000+800          | 80 / 140 / 220  |
| Cami        | 2      | +6 / +10 / +15 huzur                                                | 9.000+500 · 16.000+1.000 · 26.000+1.800  | 150 / 250 / 400 |
| Hamam       | 2      | +3 / +5 / +8 huzur; büyüme +%0,05 / +%0,1 / +%0,15                  | 7.000+300 · 13.000+600 · 21.000+1.200    | 100 / 180 / 280 |
| Kervansaray | 1      | +800 / +1.600 / +2.600 akçe; sur dışında                            | 10.000+600 · 18.000+1.000 · 30.000+1.800 | 100 / 180 / 300 |
| Ambar       | 2      | erzak +15.000 / +30.000 / +50.000; büyüme +%0,15 / +%0,25 / +%0,4   | 5.000 · 9.000+300 · 15.000+700           | 80 / 140 / 220  |
| Kışla       | 1      | 2.000 / 5.000 / 10.000 asker yeri; +3 / +6 / +10 huzur; sur dışında | 12.000+600 · 24.000+1.600 · 42.000+3.200 | 200 / 350 / 550 |
| Medrese     | 1      | vergi +%5 / +%10 / +%15; huzur +1 / +2 / +3                         | 11.000+600 · 19.000+1.200 · 30.000+2.000 | 180 / 300 / 450 |
| Darüşşifa   | 1      | büyüme +%0,1 / +%0,2 / +%0,3; huzur +2 / +3 / +5                    | 10.000+500 · 17.000+1.000 · 28.000+1.800 | 150 / 250 / 400 |

Yıkılan yapı, son seviyesinin akçe bedelinin dörtte birini geri verir. Kesin sayılar
`data/balance.json` içindedir.

### Ordu (8. aşama)

Kışla şehrin ordugâhıdır: askeri halktan toplar, talim ettirir ve konaklatır. Ordu
ileride kampanya haritasında yürüyecek, savaş katmanında çarpışacak; şehir onu besler,
öder ve barındırır.

- **Kışla sur dışına kurulur ve kocamandır:** 26×22 karo (≈260×220 m), on bin askerin
  saf tutabileceği bir meydanla. Yer ilk seviyede bütünüyle ayrılır, yerleşke seviyeyle
  o yerin içinde büyür:
  - **I, ordugâh (2.000 asker):** kazıklı çit, ahşap koğuş, sıra sıra keçe otağlar, dört
    ahşap gözcü kulesi, at bağlama direği, üç hedefli ok menzili.
  - **II, kışla (5.000 asker):** mazgallı taş duvar, köşelerde ve duvar boyunca kuleler,
    kemerli kapı, üç taş koğuş, iki ahır ve çitli ağıl, iki kuyu, silah sehpaları, beş
    hedef.
  - **III, ribat (10.000 asker):** yüksek sur ve sık kuleler, iki yuvarlak kuleli taç
    kapı, dört kurşun kubbeli koğuş, üç ahır, iki kubbeli cebehane, minareli mescit,
    yedi hedef. Yerleşke eğimli arazide toprağı izler.
- **Birlikler bölük bölük toplanır.** Bölük büyüklükleri dönemin gerçeğine yakındır:

  | Birlik              | Er  | Bedel | Talim | Ulufe/ay | Kışla | Yakın / Savunma / Ok / Hız / Moral |
  | ------------------- | --- | ----- | ----- | -------- | ----- | ---------------------------------- |
  | Mızraklı yaya       | 100 | 1.000 | 2 ay  | 40       | I     | 6 / 8 / 0 / 3 / 6                  |
  | Yaya okçu           | 100 | 1.200 | 2 ay  | 45       | I     | 3 / 3 / 8 / 3 / 5                  |
  | Türkmen atlı okçusu | 100 | 2.500 | 3 ay  | 90       | II    | 4 / 4 / 7 / 9 / 6                  |
  | Gulam süvarisi      | 50  | 3.000 | 4 ay  | 110      | III   | 9 / 9 / 0 / 7 / 9                  |

  Selçuklu ordusunda asker 50'lik ve 100'lük (hayl) birlikler hâlinde sayılırdı; bölükler
  bu yüzden 100 er, sultanın zırhlı gulamları 50'şer. Kışlanın panelinden bir türden bir,
  beş ya da on bölük birden toplanır; panel bölükleri türe göre sayar (kaç bölük, kaç er,
  kaçı talimde) ve **Terhis** o türün en son toplanan bölüğünü evine gönderir.

  Savaş değerleri şimdilik yalnız veridedir; savaş katmanı onları kullanacak.

- **Askerler halktan gelir.** Bölük toplanınca o kadar kişi nüfustan çıkar ve kışlaya
  girer; terhis edilince evine döner. Kışla yıkılırsa bütün bölükler terhis olur.
- **Sınırlar:** ordu kışlanın yerini (2.000 / 5.000 / 10.000) ve halkın verebileceğini
  (herkesin, askerler dahil, %15'i) aşamaz.
- **Ordu şehre yüktür:** her bölük her ay ulufe alır (Hesap'ta ayrı satır), askerler
  şehrin erzağından yer, vergi vermez. Şehir düzeyi hesaplanırken garnizon şehrin
  nüfusuna sayılır.
- **Askerler kışlada tek tek görünür.** Her er bir figürdür: on bin kişilik ordu on bin
  figür. Bölükler meydanda türe göre bir arada, sık düzende (yayada adam başına ≈1,25 m,
  atlıda ≈1,6 m) saf saf durur; meydana sığmazlarsa saflar sıklaşır; talimdeki mızrakçılar sıra sıra hamle yapar,
  okçular hedeflere ok atar ve oklar havada uçar, atlılar meydanın çevresinde tur atar
  (Türkmenler atın üstünden yana ok atar, gulamlar kargıyı indirip hücum eder). Hazır
  bölükler saflarında bekler.
- **Savaşa hazır figürler:** her asker gövde, baş, miğfer ya da börk, iki kol, iki
  bacak, silah (mızrak, kılıç, yay, flamalı kargı), kalkan ve sadaktan oluşan eklemli
  bir düzenektir; at da gövde, boyun, dört bacak ve kuyruktan. Hareketler: bekleme,
  yürüyüş, hücum, mızrak hamlesi, kılıç çalma, ok atma, kalkanla karşılama, düşme; at
  için adım, dörtnala, üstünden ok atma ve kargıyla hücum. Hepsi tek tek parça olarak
  çizilir; on bin asker birkaç düzine çizim çağrısıdır (`src/render/soldiers.ts`).
- **On bin figür akıcı kalsın diye:** aynı anda aynı harekette olan askerler duruşu
  paylaşır (bir duruş bir kez hesaplanır, her asker yalnız döndürülüp yerine konur);
  talimdekiler saniyede otuz kez, hazır bekleyenler dilim dilim birkaç kez güncellenir ve
  ekran kartına yalnız değişen kısım gider. Aynı anda en çok üç atlı bölüğü tur atar,
  gerisi sırasını bekler. Kamera uzaklaşınca ok, sadak, flama ve kuyruk çizilmez.
- Kamera askerleri seçebilmek için eskisinden daha yakına iner.

### Surlar ve sokaklar

Şehir büyüdükçe kendi kabuğunu da büyütür.

- **Yeni sur halkası.** Şehir gereken düzeye varınca eski surun dışına yeni bir halka
  örülebilir. Duvar aylarca, gözle görülür biçimde, halkanın çevresinde dolanarak yükselir.
  Bitince halka her sokağın geçtiği yerde bir kapı açar ve kapılar eski kapıların adını
  alır (Larende Dış Kapısı, Varoş Kapısı…). Halkanın içinde bir çevre yolu ve ondan ayrılan
  sokaklar, eski şehre bağlanan yollar açılır; yeni mahalleler bunların boyunca dolar.
- **Sur çayın bu yakasında kalır.** Halka daire olarak çizilir. Meram Çayı dairenin içine
  giriyorsa duvar suyu aşmaz, şehir tarafındaki kıyıyı izler ve çay hendek olur. Çay
  eski sura o kadar yakınsa ki araya yeni sur sığmıyorsa (4,5 karodan az), orada duvar
  örülmez; yeni sur kıyıda bir kuleyle biter ve içeri dönüp içteki sura bağlanır, kıyı
  boyunca açık yol kalmaz. Surun altında kalan bir sokak surdan geçiyorsa kapı olur, surla
  yan yana uzanıyorsa kesilir; kıyıdaki ağaçlar surun yolundan çekilir. "Sur içi" her
  yönde surun gerçekten çevirdiği yere kadardır; çayın ötesindeki evler varoştur.

  | Halka      | Yarıçap | Gerekli düzey | Bedel          | Süre  | Kazanç                  |
  | ---------- | ------- | ------------- | -------------- | ----- | ----------------------- |
  | Dış Sur    | 34      | Büyük Şehir   | 50.000 + 4.000 | 10 ay | +2 yapı hakkı, +5 huzur |
  | Varoş Suru | 46      | Payitaht      | 90.000 + 8.000 | 14 ay | +3 yapı hakkı, +5 huzur |

- **Varoş sokakları.** Sur dışında, kapı yollarının arasında üç çevre yolu (eski surdan
  6, 17 ve 29 karo ötede) vardır. Başlangıç nüfusunun üstünde her 5.500 kişide bir yeni
  parça açılır: bir kapı yolundan ötekine uzanan yay ve ondan ayrılan iki sokak. Açılan
  yol tarlanın üstüne düşerse tarla kalkar. Sıra şehrin tanımından çıkar; her oyunda
  aynıdır ve kayıtta yalnız kaçıncı parçaya varıldığı tutulur.

### Yapıları görmek

Oyuncu hangi yapının ne beklediğini haritada ve tek bir listede görür.

- **Rozetler:** yakından bakınca her yapının üstünde seviyesini (I, II, III) gösteren
  bir rozet durur. Yükseltilebilir yapınınki lacivert zeminde altın ▲ ile nabız atar;
  akçe ya da taş bekleyeninki soluk ▲ taşır; inşaattakinde ilerleme çubuğu vardır.
  Rozete tıklamak kamerayı yapıya götürür ve panelini açar.
- **İnşa kartları:** şu an başlanamayan yapının kartı soluklaşır ve neyin eksik olduğunu
  kırmızıyla yazar: `taş 30/50`, `akçe 700/900`, `ustalar işte 2/2`, `yapı hakkı dolu 5/5`,
  `en çok 2`. Yer seçmeden önce görülür.
- **Defter:** Şehir satırında yapı hakkı (`yapı 3/5`), İnşaat satırında aynı anda yürüyen
  inşaat ve yükseltmeler (`1/2 · 1 usta boşta`). İkisi ayrı sınırdır: yapı hakkı şehirde
  kaç yapı olabileceğini, ustalar kaçının aynı anda yapılabileceğini söyler.
- **Yapılar listesi** (araç çubuğu ya da **L**): bütün yapılar, yükseltilebilir olanlar
  önde; her satırda seviye, etki, sonraki basamağın bedeli ya da neyi beklediği. En üstte
  sıradaki sur halkasının kartı durur. Düğmedeki sayı, şu an başlatılabilecek iş
  sayısıdır. Yapı hakkı (kullanılan/toplam) da buradadır.
- **Basamaklar:** yapının panelinde üç seviye alt alta görünür: bitenler işaretli,
  süren iş kalan ayıyla, sıradaki bedeli ve eksiği ile (Taş yetmiyor, 🔒 Şehir Büyük Şehir
  olunca…), sonrakiler soluk.

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
  (seviye ve süren işleriyle), hangi tarlaların kaldığı, kaç sur halkasının örüldüğü (ve
  sürenin kalan günü) ve kaç varoş sokağının açıldığı. Arazi, surlar, sokaklar ve arsalar
  şehrin tohumundan yeniden üretilir; kayıt küçük kalır (birkaç KB).
- **Menü:** Kaydet, Kaydı yükle, Otomatik kaydı yükle, Dosyaya indir, Dosyadan yükle,
  Müzik, Yeni oyun (iki tıkla).
- Oyun her ay başında kendini otomatik kaydeder ve açılışta kaldığı yerden devam eder.
- Başka şehrin, başka sürümün ya da bozuk bir kaydın yüklenmesi reddedilir ve nedeni
  söylenir. Şehir on kat büyütülmeden önceki (1. sürüm) kayıtlar reddedilmez: nüfusları,
  akçeleri ve taşları on katına çıkarılarak yüklenir.

## Telefon (6. aşama)

- Dokunmatikte ilk dokunuş yapının yerini ve fiyatını gösterir, aynı yere ikinci dokunuş
  kurar; yıkmak da böyledir. Parmak her şeyi kapattığı için ipucu sabit bir yerde durur.
- Dar ekranda saat ve menü üst satırda, defter onun altında iki sütun; inşa kartları
  araçların üstünde yana kayan tek sıra; bilgi paneli ekran genişliğinde.

## Teknik kararlar

- **Karo ızgarası.** Harita 200×200 karo; bir karo ≈ 10 m. Tepe ≈ 22 m yüksekliğinde.
- **Sokaklar sahnenin parçasıdır.** Şehrin tanımından ve `seed`'den üretilir, oyuncu
  değiştirmez; evler ve yürüyen halk onları izler. Şehir büyüdükçe yenileri tanımdaki
  sırayla açılır, bu yüzden kayıttan yüklenen şehir aynı sokaklara kavuşur.
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

| #   | Aşama                                                                                                                               | Durum |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | **Zemin:** arazi, Konya'nın çekirdeği, sokaklar, kamera, zaman, minyatür görüntü                                                    | ✅    |
| 2   | ~~Konut imarı ve tarla çizme~~ — sade çekirdekte kalktı                                                                             | ↺     |
| 3   | ~~Üretim zincirleri, esnaf~~ — sade çekirdekte kalktı                                                                               | ↺     |
| 4   | ~~Hizmet menzilleri, bütçe, vakıf~~ — sade çekirdekte kalktı                                                                        | ↺     |
| 5   | ~~Olaylar ve savunma (ilk deneme)~~ — git geçmişinde; 7. ve 8. aşamada yeniden                                                      | ↺     |
| Ç   | **Sade çekirdek:** akçe ve şehir ürünü, serbest yerleşim, üç seviyeli yapılar, nüfus, huzur, vergi                                  | ✅    |
| 6   | **Cila:** mevsim görünümleri, ses ve müzik, kayıt/yükleme, telefon                                                                  | ✅    |
| 6b  | **Zorluk ve büyüme:** yapı hakkı, tür sınırı, bakım, erzak, borç; sur halkaları, varoş sokakları; yapı rozetleri ve Yapılar listesi | ✅    |
| 7   | **Olaylar:** yangın, salgın, kıtlık, Moğol elçileri ve Kösedağ, bu çekirdeğe uyarlanmış                                             |       |
| 8   | **Ordu:** sur dışında büyüyen kışla, gerçekçi bölükler, ulufe ve erzak, eklemli ve savaşa hazır askerler, kışlada birebir konaklama | ✅    |
| 8a  | **Tarihî ölçek:** nüfus ve ekonomi ×10 (Konya 42.000 kişi), 10.000 askerlik kışla, toplu asker toplama, on bin figürün akıcı çizimi | ✅    |
| 8b  | **Savunma:** garnizonla sur savunması, sur bakımı, kuşatmaya hazırlık                                                               |       |
| 9   | **Kampanya bağlantısı:** birden çok şehir, ürünlerin imparatorluk deposuna akışı                                                    |       |
