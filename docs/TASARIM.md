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

### İlk döngü (2. aşamada kurulan)

Sayılar `data/balance.json` dosyasında; burada yalnızca kurallar var.

```
Konut arsası ─► ev ─► nüfus ─► işgücü ─► tarlalar (önce), diğer işler
                                  │
       ambar ◄── hasat ◄──────────┘            hazine ◄── hane vergisi (aylık)
         │
         └──► tüketim (kişi başı aylık) ──► ambar biterse kıtlık, evler boşalır
```

- **Konut talebi** iki şeyden gelir: işsizlik hedefin altında mı (iş payı) ve ambar kaç
  aylık yiyecek tutuyor (yiyecek payı). Talep varken evler, bir yola **en fazla 2 karo**
  uzaklıktaki imarlı arsalarda günde birkaç tane yükselir; talep çok düşerse ya da kıtlık
  varsa evler boşalır. Talep yüksekken bazı evlere ikinci kat çıkar.
- **İmar ücretsizdir**, yalnızca arsayı işaretler. Yola uzak arsalar soluk çizilir ve yol
  gelene dek boş kalır.
- **İşgücü:** nüfusun bir payı çalışır. İşçiler önce tarlalara gider; kalan cami, hamam
  gibi yapıların işlerine. İşçi yetmezse tarlanın bakımı ve hasadı düşer.
- **Tarla çizmek** hazineden karo başına ücret ister (en az 2×2, en çok 16 karo kenar).
  Tarlaya yol değmiyorsa işlenmez. Tarla evlerden uzaklaştıkça verim biraz düşer.
- **Ekin:** buğday toprağın verimini yakından izler; arpa kötü toprakta daha iyi dayanır
  ama iyi toprakta daha az kazandırır. Oyuncu her tarla için gelecek ekimi seçer:
  buğday, arpa ya da **nadas**.
- **Takvim:** Mart–Nisan ekim, Ağustos başında hasat. Ekili toprak her hasatta yorulur;
  nadasa bırakılan toprak bir yılda gücünün bir kısmını geri alır.
- **Başlangıç:** şehir yol boylarında hazır tarlalarla ve bir yıla yakın zahireyle gelir.
  Hiçbir şey yapılmazsa topraklar yorulur ve üçüncü yıl ambar boşalmaya başlar; oyuncu
  nadas düzeni kurmalı ve yeni tarla açmalıdır.
- **Sulama** 4. aşamada su dolabıyla geldi: dolabın çevresindeki tarlalar daha çok verir.

### İmalathaneler

Değirmen, Boyahane, Dökümhane, Tabakhane, Kiremithane, Taş ocağı, Maden. Tabakhane
kokusu, dökümhane dumanı konut değerini düşürür: yerleşim kararı önemlidir.

### Çarşılar

Arasta, Bedesten, Han; dış ticaret için Kervansaray. **Narh:** muhtesib üzerinden fiyat
tavanı — halk memnun, esnaf kârı düşer.

### Üretim zincirleri (3. aşamada kurulan)

Sayılar `data/balance.json` dosyasında. Şehrin tek ortak deposu var: zahire ambarda,
öteki mallar depoda durur; taşıma yok.

```
Tarla ─ zahire ─► Değirmen ─ un ─────► Fırıncı  ─ ekmek ─► halk (yiyecek + refah)
Mera ── yün ────► Boyahane ─ iplik ──► Dokumacı ─ kumaş ─► halk (refah)
Maden ─ cevher ─► Dökümhane ─ demir ─► Demirci  ─ alet ──► tarlalar (verim)
   devlet yatırımı (oyuncu kurar)      esnaf (arastada kendiliğinden açılır)
```

- **Yapı aracı** ile imalathaneler ve arasta kurulur. Her yapının kenarı bir yola
  değmeli; yolsuz yapı çalışmaz. Yön kendiliğinden seçilir, ön yüz yola bakar.
  - **Değirmen:** Suya bitişik kurulur (su değirmeni); zahireyi una çevirir.
  - **Boyahane:** Suya en fazla 2 karo uzakta kurulur; yünü boyalı ipliğe çevirir.
  - **Maden:** Tepelerdeki **demir damarı** üstüne kurulur; cevher çıkarır.
  - **Dökümhane:** Cevheri demire çevirir. Çevresine **duman** yayar.
  - **Arasta:** Dört dükkânlı çarşı sırası. Dükkânları oyuncu değil esnaf doldurur.
- **Mera**, Tarla aracında üçüncü seçenektir. Tarla gibi çizilir ama zayıf ve eğimli
  toprağa da olur. Çobanlar ister; **Mayıs'ta kırkım** yapılır, yün depoya girer.
- **İmalathane üretimi:** Tam kadroda aylık bir kapasitesi var. İşçi azsa ya da girdi
  yoksa az üretir. Çıktısı depoda sınırı aşınca bekler, böylece kimsenin almadığı mal
  birikip zahireyi tüketmez.
- **Esnaf:** Her ayın başında her arasta bir değişiklik düşünür:
  - Boş dükkâna, girdisi depoda olan ve talebi en az karşılanan zanaat açılır.
  - İki ay girdisiz kalan dükkân kapanır.
  - Dükkân sayısı talebi açıkça aşarsa biri kapanır.
- **Para:** Esnaf girdisini (un, iplik, demir) devletten satın alır; bu hazinenin geliri.
  Halkın çarşıdan aldığı ekmek ve kumaştan **çarşı vergisi** alınır.
- **Halkın ihtiyaçları:**
  - **Ekmek yiyecektir.** Halk yiyeceğinin yarısını fırından almak ister; alınan ekmek
    kadar ambardan daha az zahire gider. Zahire biterse depodaki un da yenir.
  - **Kumaş:** Her hane arada bir kumaş alır.
- **Refah**, ekmek ve kumaş ihtiyacının ne kadar karşılandığıdır. Evlerin ikinci kata
  çıkması refaha bağlıdır; iyi bir çarşı konut talebini de biraz artırır.
- **Alet:** Tarlalar aletle daha çok verir; alet tarla karosu başına azar azar tükenir.
- **İşgücü sırası:** Önce tarlalar ve meralar, sonra imalathaneler ve dükkânlar, sonra
  öteki işler.
- **Duman:** Dökümhane çevresindeki evler kat çıkmaz. Yeni evler de önce dumansız
  arsalara yapılır.
- **Başlangıç:** Konya, Meram Çayı üstünde bir değirmen ve iki fırıncısı olan bir
  arastayla başlar. Kumaş ve alet zincirlerini oyuncu kurar.
- **Sonraya kalanlar:**
  - Narh, bakım giderleri ve bütçe: 4. aşama.
  - Kervansaray ve dış ticaret, bedesten ve han.
  - Tabakhane, kiremithane ve taş ocağı (yapı malzemesi, kamu yapılarıyla birlikte).

### Kamu yatırımları

Cami/Mescit, Medrese, Hamam, Darüşşifa, Çeşme, Su yolu, İmaret, Ahi zaviyesi, Subaşı
karakolu, Sur, Burç, Kapı. Her birinin etki alanı ve bakım gideri var. **Vakıf:** yapı
hazineden ödenir ya da bir eşrafa vakıf olarak yaptırılır (hazineye yük yok, geliri
kalıcı olarak vakfa gider).

### Bütçe

- Gelir: ev vergisi, çarşı vergisi, devlet ürününün esnafa satışı, kervansaray gümrüğü.
- Gider: bakım, garnizon, sultana pay; 1243'ten sonra İlhanlı vergisi.

### Hizmetler ve bütçe (4. aşamada kurulan)

Sayılar `data/balance.json` dosyasında.

- **Kamu yapıları** Yapı aracının Hizmet sekmesinden kurulur. Her birinin bir **etki
  alanı** (yarıçap) ve aylık **bakım gideri** var; çalışmaları için yola bağlı olmaları ve
  işçi bulmaları gerekir.

  | Yapı         | Hizmet   | Ne işe yarar                                             |
  | ------------ | -------- | -------------------------------------------------------- |
  | Çeşme        | Su       | Evin iki kat olabilmesi için gerekir                     |
  | Mescit       | İbadet   | Evin iki kat olabilmesi için gerekir                     |
  | Hamam        | Temizlik | Konak için gerekir                                       |
  | Medrese      | Eğitim   | Konak için gerekir (ya da darüşşifa)                     |
  | Darüşşifa    | Sağlık   | Konak için gerekir (ya da medrese)                       |
  | Ahi zaviyesi | —        | Çevresindeki arastaların esnafı aynı girdiden çok üretir |
  | Su dolabı    | Sulama   | Suya bitişik kurulur; çevresindeki tarlalar sulanır      |

- Şehrin anıt yapıları da hizmet verir: Alaeddin Camii bütün sur içine, mescitler kendi
  mahallesine ibadet; Çifte Hamam çevresine temizlik. Konya sur içinde çeşmelerle başlar.
- **Konut düzeyleri:** ev (1 hane), iki katlı ev (2 hane), konak (3 hane, daha çok vergi
  öder).
  - İki kat için su ve ibadet gerekir.
  - Konak için bunlara ek olarak temizlik, eğitim ya da sağlık, yüksek refah ve dumansız
    hava gerekir.
  - Hizmeti ve refahı yeten evler zamanla bir kat çıkar; yetmeyen evler bir kat
    kaybeder, hanesi göç eder.
- **Bütçe** her ayın başında kapanır:
  - Gelir: hane vergisi, esnafa satış, çarşı vergisi.
  - Gider: yapıların bakımı, vakıf payları, sultana pay (gelirin bir payı).
- **Vergi oranı:** Hafif, orta ya da ağır. Ağır vergi hazineyi doldurur ama konut
  talebini düşürür; hafif vergi göçmen çeker.
- **Narh:** Muhtesib ekmek ve kumaşa fiyat tavanı koyar. Halkın refahı artar; çarşı
  vergisi düşer, esnaf yeni dükkân açmakta daha isteksiz olur.
- **Borç:** Hazine eksiye düşerse kamu yapılarının görevlileri maaş alamaz, hizmet durur.
  Yeni yapı kurulamaz.
- **Vakıf:** Bir kamu yapısı, hazır bir eşrafa vakıf olarak yaptırılabilir. Hazineden
  para çıkmaz; bakımını vakıf öder ve hazine borçta olsa da çalışır. Karşılığında vakıf,
  yapının değerinin bir payını her ay kalıcı olarak alır. Şehirde vakıf yaptıracak eşraf
  sayısı nüfusla ve konaklarla artar.
- **Bilgi katmanları:** Verimlilik, her hizmetin kapsamı, sulama, duman ve konut düzeyi.
  Konut katmanı, hizmeti yetmediği için küçülecek evleri kırmızıyla gösterir.
- **Sonraya kalanlar:** İmaret ve subaşı karakolu (5. aşamada kıtlık ve yangınla
  birlikte), garnizon gideri.

### Olaylar

Yangın (ahşapta yayılır, çeşme yakınında az zarar), salgın, kıtlık, deprem, Mevlana'nın
sohbetleri, Moğol elçileri, Ahi ayaklanmaları. Her olayda bir seçim.

### Olaylar ve savunma (5. aşamada kurulan)

Sayılar `data/balance.json` dosyasında. Olaylar şehrin kendi rastgelelik akışından gelir;
aynı şehir aynı seçimlerle aynı tarihi yaşar.

- **Olay penceresi:** Bir olay çıkınca oyun durur ve seçenekler sunulur. Seçim yapılınca
  zaman kaldığı hızla akar. Her olay ve seçim **Vakayiname**'ye yazılır.
- **Yangın:** Yaz aylarında ve sık evli mahallelerde daha sık çıkar. Ateş her gün
  komşu evlere sıçrayabilir; yanan ev yıkılır, arsası bir süre kül olarak kalır.
  - Çeşmeye yakın evlere ve subaşı karakolunun çevresine zor sıçrar.
  - Seçenekler:
    - Subaşının adamlarını gönder: para ister, yayılmayı yarıya indirir.
    - Çevredeki evleri yıkıp ateşi kes: ateş hemen durur, yıkılan evler gider.
    - Kendi hâline bırak.
- **Salgın:** Kalabalık ve sağlık hizmeti az olan şehirde çıkar. Aylarca sürer, her gün
  bazı hanelerden can alır; darüşşifanın ve hamamın çevresi daha az etkilenir. Salgında
  sokaklar boşalır, göçmen gelmez.
  - Seçenekler:
    - Karantina: salgını yarıya indirir ama çarşı ve esnaf satışı da yarıya düşer.
    - Hekim ve ilaç: para ister, salgını hafifletir.
    - Dua et, bekle.
- **Kıtlık:** Ambar iki aylık zahirenin altına inince çıkar.
  - Seçenekler:
    - Sultandan zahire iste: bir yıl boyunca sultan payı artar.
    - Eşraftan satın al: para ister.
    - Halk kendi başının çaresine baksın.
  - **İmaret** çevresindeki evler kıtlıkta göç etmez.
- **Deprem:** Seyrektir. Evler kat kaybeder, surlar yıpranır. Yıkılanlar hazineden
  onarılabilir.
- **Mevlânâ'nın sohbetleri:** Bir medrese varsa bir kez gelir. Sohbetler şehrin ününü
  artırır: konut talebi ve refah yükselir. Mevlânâ'ya bir medrese vakfetmek bunu kalıcı
  kılar.
- **Ahi huzursuzluğu:** Ağır vergi ya da uzun süren düşük refah ahileri kızdırır.
  - Seçenekler:
    - Vergiyi hafiflet.
    - Şeyhlerle anlaş: para ister.
    - Subaşıyı gönder: garnizon yeterliyse bastırılır ama refah düşer; yetmezse
      çarşıda dükkânlar kapanır.
- **Kervan:** Arada bir Tebriz'den ya da Antalya'dan bir kervan gelir. Depodaki fazla malı
  iyi fiyata alır, ya da ipek ve baharat satar (refah), ya da gümrük verip geçer.
- **Moğol tehdidi:** 1236'dan sonra her yıl artar. Moğol elçileri gelir: hediyelerle
  ağırlamak tehdidi azaltır, kovmak artırır.
- **Kösedağ (1243):** Selçuklu ordusu Kösedağ'da yenilir.
  - Seçenekler:
    - Teslim ol: şehir korunur ama hazine her ay gelirin bir payını **İlhanlı vergisi**
      olarak öder.
    - Direnin: sonucu surların sağlamlığı ve garnizon belirler. Başarılı olursa şehir
      birkaç yıl vergisiz kalır. Başarısız olursa şehir yağmalanır: hazine ve depo
      yarılanır, sur dibindeki evler yanar, vergi yine gelir.
- **Garnizon:** Asker sayısını oyuncu seçer.
  - Askerler maaş ister, yiyecek yer ve işgücünden düşer.
  - Kapılarda nöbet tutar, surlarda devriye gezerler.
- **Surlar:** Zamanla ve depremle yıpranır; Savunma panelinden para karşılığı
  onarılır.
- **Subaşı karakolu:** Çevresinde yangını ve asayişsizliği azaltır.

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
- **Desenli dolgu:** zeminde ot öbekleri ve çiçekler, suda dalga çizgileri, tarlalarda
  mevsime göre filiz, başak, anız ve saban izi.
- **Halk:** sokaklar kalabalıktır. Figürler minyatürdeki gibi gerçekten biraz iridir;
  kaftanları renk renk, başlarında sarık, börk ya da örtü vardır. Sayıları nüfusla artar,
  en çok evlerin, çarşının ve caminin çevresinde dolaşırlar; evlerine girip çıkarlar.
  Çarşıda dükkân önünde müşteriler, çeşme başında testili kadınlar, cami kapısında
  cemaat, kapılarda yolcular, yük eşekleriyle kervancılar görünür. Tarlada ekimden
  hasada çiftçiler çapalar, merada çoban sürüsünün başındadır. Figürler yalnızca
  görüntüdür, simülasyonu etkilemez; oyun durunca onlar da durur.
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
| 2   | **Konut ve tarım:** konut imarı, nüfus, tarla çizme, hasat, ambar — ilk oynanabilir döngü                  | ✅    |
| 3   | **Üretim ve çarşı:** imalathaneler, çarşılar, esnaf, üretim zincirleri                                     | ✅    |
| 4   | **Hizmetler ve bütçe:** kamu yapıları, etki alanları, bilgi katmanları, vergi, vakıf                       | ✅    |
| 5   | **Olaylar ve savunma:** yangın, salgın, kıtlık, Moğol elçileri, sur, garnizon                              | ⏳    |
| 6   | **Cila:** mevsim görünümleri, ses, kayıt/yükleme, telefon                                                  |       |
