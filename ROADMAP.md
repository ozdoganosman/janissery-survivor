# Janissary Survivor — Yol Haritası

> Yeniçeri konseptli, fantastik/mitolojik Osmanlı temalı, Vampire Survivors
> mekaniklerine dayanan 3D tarayıcı oyunu.

---

## 1. Sabitlenen Kararlar

Bu kararlar roadmap'in temelini oluşturur; değişirlerse fazlar yeniden
değerlendirilmelidir.

| Konu           | Karar                                                           | Gerekçe                                                                   |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Hedef platform | **Web** (masaüstü tarayıcı öncelikli, mobil web "nice to have") | Dağıtım maliyeti sıfır, iterasyon hızlı                                   |
| Render         | **Three.js + TypeScript + Vite**                                | En hafif bundle, `InstancedMesh` ile kalabalık sürü kontrolü, tam kontrol |
| Modeller       | **Prosedürel voxel** — JSON tanım + kod builder                 | Binary asset yok, git-diff okunabilir, rigging gereksiz                   |
| Kamera         | **Top-down, hafif eğimli ortografik** (~55° pitch)              | Sürü okunabilirliği + 3D görsellik; çarpışma XZ düzleminde 2D kalır       |
| Tema           | **Fantastik/mitolojik Osmanlı**                                 | Yaratıcı alan geniş, tarihsel hassasiyet riski yok                        |
| MVP            | Tek harita, 15 dakikalık run, meta-progression yok              | Gerçekçi dikey dilim                                                      |

### Neden voxel bu proje için doğru karar

Minecraft tarzı blok estetiği burada estetik bir tercihten fazlası:

- **Asset riski yok** — modeller `data/models/*.json` içinde veri olarak yaşar,
  kod bunları merged `BufferGeometry`'ye çevirir. Repo boyutu ~0, indirilecek
  `.glb` yok.
- **Rigging yok** — animasyon uzuvları pivot noktasından döndürmekle olur
  (yürüme = bacak salınımı, saldırı = kol yayı). Tam Minecraft mantığı.
- **Performans bedava** — tüm düşmanlar tek `InstancedMesh` ile çizilir, çünkü
  hepsi aynı geometriyi paylaşır. Renk varyasyonu instance attribute ile.
- **Kimlik net okunur** — beyaz _börk_, kırmızı kaftan, yatağan silueti blok
  çözünürlüğünde bile tanınır.

---

## 2. Mimari Prensipler

Bunlar Faz 0'da kurulur ve sonrasında pazarlık konusu değildir — geç değişimi
en pahalı olan kararlardır.

**Sabit adımlı simülasyon (fixed timestep).** Simülasyon 60 Hz sabit adımda
koşar, render araya interpolasyon yapar. Değişken `deltaTime` ile hasar/hareket
hesaplayan oyunlar farklı makinelerde farklı zorlukta olur; bunu baştan
engelliyoruz.

**Veri odaklı sıcak döngü.** Düşmanlar ve mermiler `class` örnekleri değil,
paralel `Float32Array`'lerdir (Structure-of-Arrays). 800 düşman × 60 Hz'de
GC duraklamasını ancak böyle sıfırlarız.

**Sıfır tahsis (zero allocation) kuralı.** Sıcak döngüde `new`, array literal,
closure yok. Her şey havuzdan (object pool) gelir. Vektör matematiği için
önceden ayrılmış scratch değişkenleri kullanılır.

**Uzamsal hash ile çarpışma.** Uniform grid (hücre ≈ 2 birim). Tüm çarpışma
XZ düzleminde daire-daire testi; Y ekseni sadece görseldir. Fizik motoru
kullanılmaz — gereksiz ağırlık ve öngörülemez davranış.

**Simülasyon ↔ render ayrımı.** `src/sim/` içindeki hiçbir dosya `three`
import etmez. Bu, oyun mantığının Vitest ile headless test edilebilmesini
sağlar ve en büyük kalite kazancıdır.

### Performans bütçeleri (Faz 3'ten itibaren her fazın çıkış kriteri)

| Metrik                    | Hedef                                  |
| ------------------------- | -------------------------------------- |
| FPS @ 800 düşman          | ≥ 60 (orta seviye laptop, entegre GPU) |
| FPS @ 300 düşman          | ≥ 60 (mobil web)                       |
| Draw call                 | < 60                                   |
| Frame başına heap tahsisi | ~0 (sıcak döngüde)                     |
| Bundle (gzip)             | < 2 MB                                 |
| Boş ekrandan oynanabilire | < 2 sn                                 |

---

## 3. Fazlar

Toplam tahmin: **5–6 hafta** (tek geliştirici, tam zamanlı benzeri tempo).
Her fazın sonunda çalışan, elle oynanabilir bir build olur — hiçbir faz
"yarım bırakılmış sistem" teslim etmez.

---

### Faz 0 — İskelet ve altyapı · ✅ tamamlandı

Oyun yok, ama her şeyin üzerine kurulacağı zemin var.

- [x] Vite + TypeScript + strict mode kurulumu
- [x] ESLint + Prettier, `npm run check` tek komutla tip + lint + format + test
- [x] Vitest kurulumu ve ilk testler (35 test: döngü + RNG)
- [x] Sabit adımlı ana döngü (`accumulator` pattern), interpolasyonlu render
- [x] Boş sahne: ortografik kamera, ışık, zemin düzlemi, frame süresi overlay'i
- [x] GitHub Actions: push'ta `npm run check` + build, bundle boyutu raporu
- [x] GitHub Pages'e otomatik deploy

**Çıkış kriteri:** Boş yeşil zeminli sahne canlı URL'de açılıyor, CI yeşil.

**Planlanandan sapmalar** (bilinçli):

- Testler `src/sim/` yerine `src/core/` için yazıldı — `sim/` henüz yok. Amaç
  (test pipeline'ının çalıştığını kanıtlamak) karşılandı.
- `Stats.js` yerine kendi overlay'imiz yazıldı: ortalama FPS değil **en kötü
  frame'i** ve düşen frame sayısını raporluyor. Periyodik hitch'ler ortalamada
  görünmez, ve sıcak döngüdeki hatalı tahsis deseni tam olarak periyodik hitch
  üretir.
- `src/sim/` içinde `three` import yasağı ESLint kuralı olarak eklendi ve gerçek
  bir ihlal denemesiyle doğrulandı — yani kural sadece yazılı değil, işliyor.
- `noUncheckedIndexedAccess` bilinçli olarak kapalı; gerekçe `tsconfig.json`
  içinde yorumda.

---

### Faz 1 — Voxel model pipeline · ✅ tamamlandı

Projenin en ayırt edici teknik parçası. Erken çözülmeli, çünkü sonraki her
faz buna dayanacak.

- [x] **JSON şeması** + yol bildiren runtime doğrulama (palet indeksi, sıfır
      hacimli kutu, çakışan uzuv rolü)
- [x] **Builder:** JSON → parça başına merged `BufferGeometry`, vertex renkli,
      görünmeyen yüzler kırpılmış
- [x] **Animatör:** iskeletsiz prosedürel poz — `idle`, `walk`, `attack`, `hit`
- [x] **Instancing katmanı:** parça başına `InstancedMesh`, animasyon GPU'da
- [x] **Debug sahnesi:** `?scene=models`, animasyon seçici, ölçüm overlay'i
- [x] **Modeller:** yeniçeri (börk, kaftan, yatağan) + karakoncolos

**Çıkış kriteri durumu:** 1000 figür render ediliyor, **18–26 draw call**
(bütçe <60). 60 FPS bu ortamda **doğrulanamadı** — headless Chromium yazılım
rasterizasyonu (SwiftShader) kullanıyor, GPU yok. Gerçek donanımda ölçülmeli.

**Plandan sapmalar** (gerekçeleriyle):

- **Yüz kırpma oranı ~%40 değil, ölçülen %8.** Plandaki mantık hatalıydı:
  "kamera açısı sabit olduğu için arka yüzler kırpılabilir" — ama figürler
  gittikleri yöne dönüyor, yani kuzeye yürürken gizli olan yüz güneye
  yürürken görünür. Kamera yönüne göre kırpmak dönen her düşmanda delik
  açardı. Onun yerine görüş-bağımsız kırpma yapıldı: başka bir kutunun tam
  olarak kapattığı yüzler. Kazanç daha küçük ama doğru, ve `BuiltModel`
  gerçek sayıyı raporluyor.
- **Hiyerarşi (`parent`) şemadan çıkarıldı.** Instanced yol GPU'da parça
  başına tek rotasyon uyguluyor, ebeveyn zinciri yürümüyor. Hiyerarşi olsaydı
  oyuncu doğru, yüzlerce düşman yanlış animasyon oynardı. Düz liste her iki
  yolun aynı şeyi göstermesini garanti ediyor; bir uzva bağlı olması gereken
  şey (eldeki yatağan) o uzvun kutu listesinde duruyor.
- **`death` animasyonu ertelendi.** Parçalara ayrılma per-instance per-part
  offset istiyor, bu da instanced yolun uniform modeline sığmıyor. Faz 3'te
  ölüm efekti olarak ayrı ele alınacak.
- **Animasyon CPU yerine GPU'da.** Parça başına CPU matrisi 800 düşmanda
  frame başına ~4800 matris ve ~76 000 float trafiği demekti. Bunun yerine
  figür durumu beş instance attribute'unda; vertex shader dönüşümü kuruyor.
  Yürüme artık frame başına **sıfır CPU işi**.

**Risk (kapandı):** Prosedürel animasyonun cansız görünmesi. Squash/stretch ve
çift frekanslı gövde salınımı eklendi, testle sınırları korunuyor.

---

### Faz 2 — Oyuncu, kamera, dünya · ✅ tamamlandı

- [x] 8 yönlü hareket (WASD + oklar + gamepad sol analog), ivmesiz ve anında
- [x] Kamera takibi: üstel yumuşatma + hıza göre bakış-ileri kayması
- [x] Harita: **Kırık Surlar** — oyuncuyu takip eden zemin, hücre tabanlı
      deterministik dekor (sur parçası, servi, kandil)
- [x] Animasyon durum makinesi: idle ↔ walk
- [x] `?debug=1` overlay: pozisyon, hız, dekor sayısı, draw call, tohum
- [x] **Dokunmatik joystick** (plana göre Faz 8'di, öne alındı — bkz. aşağı)

**Çıkış kriteri:** Boş dünyada dolaşmak akıcı hissettiriyor. Bu subjektif kriter
**senin doğrulaman gereken** tek madde — ben ancak hareketin doğru olduğunu
ölçebilirim, iyi hissettirdiğini değil.

**Plandan sapmalar** (gerekçeleriyle):

- **Ölü bölge (dead zone) eklenmedi.** Kurarken görüldü ki ölü bölge, oyuncu
  durduğunda onu ekranın merkezinden kaydırıyor; etrafının sarılması üzerine
  kurulu bir oyunda bu, ekranın bir tarafına diğerinden fazla uyarı süresi
  vermek demek. Yalnızca yumuşatma titremeyi zaten kaldırıyor.
- **`hit` animasyonu bağlanmadı.** Henüz hasar kaynağı yok; durum makinesi
  hazır, Faz 4'te hasar boru hattıyla birlikte bağlanacak.
- **Sonsuz zemin "tiling" ile değil, oyuncuyu takip eden tek düzlemle
  yapıldı.** Düzlem yalnızca tam grid karesi adımlarıyla kayıyor: sürekli
  kaydırmak grid çizgilerini oyuncunun altında sürükler ve hareket hissini
  tamamen yok ederdi.
- **Dokunmatik joystick Faz 8'den öne alındı.** Plana göre mobil desteği en sona
  bırakılmıştı, ama test edilebilir bir sürüm yayınlandığı anda telefonda hiç
  oynanamaz olduğu ortaya çıktı — klavye ve gamepad'in ikisi de yok. Yüzen
  joystick: parmağın indiği yerde beliriyor. Sabit bir pad köşede aranmayı
  gerektirir, kalabalıktan gözünü ayırmak ise bu türün asla vermediği şey.
  Kalite kademesi Faz 8'de kaldı.
- **Kamera artık dar ekran eksenini sabitliyor, dikeyi değil.** Dikey açıklığı
  sabit tutmak masaüstünde doğru, telefonda dikey tutulunca yıkıcı: 390x844 bir
  pencerede 26 birim yükseklik ama yalnızca 12 birim genişlik görünüyordu, yani
  yandan gelen bir düşmana tepki süresi masaüstünün yarısı. Etrafının sarılması
  üzerine kurulu bir oyunda görüş mesafesi her yönde eşit olmalı.

**Yol boyunca bulunan hata:** Dekor hücrelerini tohumlayan hash zayıftı — 13×13
lük bir blokta 169 hücrenin yalnızca 123'ü farklı değer üretiyordu. Çarpışma,
iki farklı hücrede birebir aynı harabenin bitmesi demek, yani gözle görülür
tekrar eden bir manzara. İki koordinat XOR'lanıp bir kez karıştırılıyordu;
her koordinat ayrı ayrı avalanche'a sokulunca 90 601 hücrede sıfır çarpışma.

---

### Faz 3 — Düşman sürüsü ve performans · ✅ tamamlandı

Projenin teknik omurgası. Burada başarısız olursak konsept web'de yürümez.

- [x] SoA düşman havuzu (kapasite 2000, sıcak döngüde hiç `new` yok)
- [x] Spawn sistemi: görüş alanının dışında bir halka üzerinde
- [x] Yapay zeka: oyuncuya yönelme + komşu itmesi (separation)
- [x] Uzamsal hash grid: sınırsız dünyada O(1) yakınlık sorgusu
- [x] Ölüm: parçalanma efekti + XP mücevheri düşürme ve toplama
- [x] Instanced render

**Çıkış kriteri — ölçüldü:**

| Ölçüm                                 | Sonuç                                            |
| ------------------------------------- | ------------------------------------------------ |
| Simülasyon, 800 düşman + 400 mücevher | **0.83 ms/adım** (bütçe 16.67)                   |
| Adım başına tahsis                    | **79 bayt** — GC sonrası heap başlangıca dönüyor |
| Ölçeklenme 200 → 1500 düşman          | **doğrusal** (2× sayı ≈ 2× maliyet)              |
| 1500 düşman, sıkışık                  | 1.86 ms/adım                                     |
| Draw call, 300 düşman                 | 19 (bütçe <60)                                   |

**Risk kapandı.** Plandaki en yüksek risk "separation O(n²)'e kaçabilir" idi.
200/400/800/1500 düşmanda, hem dağınık hem sıkışık halde ölçüldü: maliyet
sayıyla doğrusal artıyor. Grid komşuluğu + düşman başına en fazla 8 komşu
sınırı bunu garanti ediyor.

**FPS hâlâ doğrulanamadı** — bu ortamda GPU yok (SwiftShader yazılım
rasterizasyonu). Ölçebildiğim şey simülasyonun frame bütçesinin %5'ini
kullandığı ve tahsis etmediği; kalanı GPU'ya bağlı.

**Plandan sapmalar** (gerekçeleriyle):

- **Geçici hasar aurası eklendi.** Faz 3 ölmenin _makinesini_ kuruyor (havuz
  slotunun serbest bırakılması, mücevher düşmesi, parçalanma) ama silahlar
  Faz 4'te. Öldüren bir şey olmadan bu makinenin hiçbiri çalıştırılamaz,
  ölçülemez, hatta görülemezdi. Faz 4'te gerçek silah setiyle değişecek ve
  Kandil'e dönüşecek.
- **Uzamsal sorgu callback yerine imleç (cursor) API'si.** `forEachNear(x, z,
r, cb)` daha okunaklı, ama döngü değişkenlerini yakalayan bir closure her
  çağrıda tahsis eder — düşman başına, adım başına. Saniyede 800 closure × 60
  tam olarak bütçenin yasakladığı testere deseni.
- **Grid, hücre dizisi değil hash.** Dünya sınırsız; oyuncu orijinden binlerce
  birim uzaklaşabiliyor, dolayısıyla hücre ayrılacak bir dikdörtgen yok.
  Çarpışan hücreler fazladan aday üretir ama asla yanlış cevap vermez: her
  aday gerçek hücre koordinatını taşıyor ve eşleşmezse eleniyor. Bu kontrol
  aynı zamanda bir varlığın iki kez ziyaret edilmesini engelliyor — yoksa tek
  bir komşu iki kat kuvvetle iterdi.
- **Silme, mezar taşı değil son elemanla takas.** İterasyon yoğun bir döngü
  olarak kalıyor ve render katmanı instance slotlarını doğrudan dizi
  indekslerine eşleyebiliyor. Bedeli: bir indeks yalnızca üretildiği adım
  içinde geçerli. Faz 4'ün delen silahları neyi vurduğunu hatırlayacağı için
  her slot bir `generation` sayacı taşıyor.

---

### Faz 4 — Silahlar ve hasar · ✅ tamamlandı

- [x] Mermi havuzu (SoA), çarpışma grid üzerinden
- [x] Silah çerçevesi: `cooldown`, `damage`, `area`, `speed`, `amount`,
      `pierce`, `duration` — hepsi `data/balance/weapons.json` içinde veri
- [x] Hasar boru hattı: temel → çarpan → kritik → azaltma, tamamen test edilmiş
- [x] Vuruş geri bildirimi: hasar sayıları, ekran sarsıntısı, hit-stop,
      düşman flaşı + geri tepme
- [x] **6 silah**, altısı da farklı hareket türünde

| Silah             | Davranış                                         |
| ----------------- | ------------------------------------------------ |
| **Yatağan**       | Oyuncunun etrafında yay çizen yakın dövüş        |
| **Tirkeş**        | En yakın düşmanı hedefleyen otomatik oklar       |
| **Mehter Davulu** | Genişleyen halka şok dalgası, güçlü geri savurma |
| **Nazar Boncuğu** | Yörüngede dönen, delen boncuklar                 |
| **Şahi Topu**     | Hedefe uçan patlayıcı gülle                      |
| **Kandil**        | Oyuncuyu saran ateş aurası                       |

**Çıkış kriteri durumu:** Altı silah aynı anda ateşlerken 250 düşmanla 23 draw
call, heap büyümesi yok. `?weapons=yatagan` gibi bir parametre tek silahı
izole ediyor — "her silah tek başına oynanabilir mi" sorusu ancak öyle
yanıtlanabilir. 60 FPS hâlâ bu ortamda ölçülemiyor (GPU yok).

**Tasarım kararları:**

- **Tek mermi havuzu, altı hareket türü.** Alternatif — silah başına sistem —
  altı havuz, altı çarpışma geçişi ve yuvarlama hatasının saklanabileceği altı
  yer demekti, karşılığında hiçbir şey. Yedinci silah eklemek bir `motion`
  vakası eklemek olmalı, bir alt sistem değil.
- **Sayılar `data/balance/weapons.json` içinde.** Kalan işin çoğu denge ayarı
  olacak ve TypeScript düzenlemeyi gerektiren her ayar turu, yapılmayacak bir
  ayar turudur. Dosya elle düzenleneceği için doğrulama alan adını söyleyen
  bir hata veriyor.
- **Kritik, azaltmadan önce.** Sıra ters olsaydı zırh şansla ölçeklenirdi:
  dayanıklı bir düşman, şanslı bir vuruşa sıradan bir vuruştan daha fazla
  direnirdi. Testi var.
- **Hasar sayıları kısıtlanıyor.** Altı silah kalabalık bir sürüye saniyede
  yüzlerce vuruş yapıyor; her birine sayı çizmek oyuncunun etrafını okunamaz
  bir rakam lekesine çeviriyordu. Kritikler her zaman görünüyor, sıradan
  vuruşlar adım başına bütçeli. Flaş zaten hepsinin isabet ettiğini
  doğruluyor.
- **Hit-stop yalnızca kritiklerde ve hız sınırlı.** Saniyede yüzlerce vuruş
  olan bir oyunda her vuruşta donmak oyunu tamamen durdurur. Donma adım
  uzunluğunu değiştirmiyor, dünyayı sabit tutuyor — adım uzunluğunu
  değiştirmek sabit adımlı simülasyonun tam olarak engellemek için var olduğu
  şey.

**Yol boyunca bulunan hatalar:**

- `Math.max(0, NaN)` sıfır değil `NaN` döndürüyor. Bozuk bir zırh değeri NaN
  hasara, o da NaN cana yol açardı — ve NaN can telafi edilemez: sonraki her
  karşılaştırma false döner, düşman ne ölebilir ne bir daha vurulabilir.
  Test yakaladı.
- Rakamlar baş aşağı render ediliyordu. `CanvasTexture` zaten `flipY`
  uyguluyor; canvas satırlarının aşağı doğru aktığını "düzeltmek" ikinci bir
  çevirme yapıp 5'i S'ye, 9'u e'ye dönüştürüyordu. Ekranda harf gibi görünen
  şeyin sebebi buydu.
- Aura diski alfa harmanlamayla çizilince yeşil zemin üstünde çamurlu bir ten
  rengine dönüşüp toprak yaması gibi okunuyordu; toplamalı harmanlama ışık
  gibi okunuyor.

---

### Faz 5 — Run içi ilerleyiş · ✅ tamamlandı

- [x] XP / seviye eğrisi, level-up'ta oyun durur
- [x] Seçim ekranı: 3 kart, ağırlıklı rastgele havuz
- [x] Silah seviyeleri 1→8, her seviye veri tablosundan
- [x] 8 pasif eşya (Kalkan, Sekban Çizmesi, Muska, Kandil Yağı, Şerbet,
      Bileyi Taşı, Dürbün, Tılsım)
- [x] **Oyuncu canı ve temas hasarı** — plan dışıydı, bkz. aşağı

**Çıkış kriteri durumu:** Run baştan sona oynanıyor — tek silahla başlıyor,
mücevher topluyor, seviye atlıyor, kart seçiyor, hasar alıyor, ölebiliyor.
15 dakika hayatta kalmak kazanmak sayılıyor. Build çeşitliliğinin _hissedilip_
hissedilmediği subjektif ve senin doğrulaman gereken kısım.

**Plandan sapmalar** (gerekçeleriyle):

- **Oyuncu canı bu faza çekildi.** Plan bunu hiçbir faza yazmamıştı, ama Faz
  5'in kendi maddeleri onu varsayıyordu: Kalkan zırh veriyor, Şerbet can
  yeniliyor, tavuk can dolduruyor — hiçbiri var olmayan bir büyüklüğü tarif
  edemez. Ayrıca kaybedilemeyen bir run, run değildir. Temas hasarı seçildi:
  bu düşmanların ne hazırlığı ne menzili var, tehdit sadece dokunulmak — ve
  türün hareket odaklılığını anlamlı kılan tam olarak bu.
- **Kalabalık hasarı doğrusal değil.** Her ek gövde giderek daha az ekliyor ve
  altıdan sonrası hiç eklemiyor. Doğrusal olsaydı, geç oyunun tamamı
  sarılmaktan ibaret olan bir oyunda ilk sarılma anı anında ölümcül olurdu ve
  öncesinde yapılan hiçbir şey önemli olmazdı.
- **Minimal HUD eklendi** (plana göre Faz 7). Görülemeyen can yönetilemez ve
  oyuncuyu öldürülebilir yapan faz buydu; en azı bu fazla birlikte gitmeliydi.
- **Altın ve sandık atlandı.** Altın meta-progression'ı besliyor, o da MVP
  dışında; hiçbir şey yapmayan bir para birimi eklemek olurdu.
- **Kart havuzunda yeni edinimler yükseltmelerden ağır basıyor.** Üç kez
  "+5 hasar" gösteren bir ekran teknik olarak seçim sunmuş, gerçekte hiçbir
  şey sunmamıştır.

**Yol boyunca bulunan hata:** `Math.max(0, NaN)` yine `NaN` — bu kez zırh
değerinde. Faz 4'te hasar boru hattında bulunan hatanın aynısı, farklı bir
sınırda tekrarlanmıştı. NaN can sıfıra hiç ulaşamaz, yani oyuncu hem
öldürülemez hem de çalışan bir can çubuğu göremez hale gelirdi. Test yakaladı.

---

### Faz 6 — Dalga direktörü ve boss · ✅ tamamlandı

- [x] Zaman çizelgesi tablosu: 9 kademe, `data/balance/waves.json` — tamamen veri
- [x] **5 düşman tipi:**

| Düşman               | Rol                                              |
| -------------------- | ------------------------------------------------ |
| **Karakoncolos**     | Temel kovalayıcı, kalabalık dolgusu              |
| **Cin**              | Hızlı, düzensiz zigzag hareket                   |
| **Gulyabani**        | Yavaş, dayanıklı, büyük — sürüde duvar oluşturur |
| **Şahmeran Yavrusu** | Çok hızlı, dalgalı hat izler                     |
| **Alkarısı**         | Mesafe koruyan menzilli saldırgan                |

- [x] Formasyonlar: halka kuşatma, duvar akını, tek yönlü akış
- [x] Elit varyantlar: instance tinti + can/boyut/ödül çarpanı (yeni model yok)
- [x] **Boss: Gulyabani Ağası** (t=10dk, t=14.5dk) — cana göre 3 fazlı,
      telegraph'lı slam
- [x] Kazanma/kayıp durumu, run özet ekranı

**Çıkış kriteri durumu:** Kademeler 55 düşmandan 440'a çıkıyor, elit şansı
%0'dan %16'ya; roster 75. saniyeden itibaren açılıyor ve 660. saniyede beş
tipin beşi de sahada. Tarayıcıda doğrulandı: erken dakika tek tip ve elitsiz, 13. dakika 550 gövde + 91 elit + 31 düşman mermisi, boss geliyor, ring'ini
çiziyor, vuruyor. Her iki bitiş de (kazanma ve ölüm) özet ekranını açıyor —
masaüstünde ve mobilde. Eğrinin _hissi_ hâlâ senin doğrulaman gereken kısım.

**Plandan sapmalar** (gerekçeleriyle):

- **Boss'a "takip hızı" eklendi.** Plan bunu içermiyordu ve onsuz boss işe
  yaramıyordu: oyuncu 5.6 br/s, boss 1.6 br/s ve boss ekranın 39 br dışında
  doğuyor. Bir kez ters yöne yürüyen oyuncu bossu run'ın geri kalanında hiç
  görmüyordu. Artık uzaktayken 7.6 br/s'ye çıkıyor, slam menziline girince
  kendi hızına düşüyor — yani gelmesi garanti, ama dövüşte hâlâ yürüyerek
  kaçılabilir. Rampanın _nerede bittiği_ kritik: kaçan oyuncu rampanın kendi
  hızına eşit olduğu noktada dengeye oturuyor, o nokta slam menzilinin dışında
  kalırsa boss orada park edip hiç saldırmıyor. İlk denemem tam olarak bunu
  yaptı (31 br'de takıldı); test bunu yakalıyor.
- **Telegraph halkası büyümüyor, doluyor.** İlk hali gerçek yarıçapının
  %35'inden başlayıp büyüyordu — yani vuruşun son anına kadar oyuncuya
  ulaşmadığı yalanını söylüyordu. Bir uyarı ancak güvenilirse uyarıdır: dış
  halka artık her zaman gerçek slam yarıçapında, içindeki disk zamanlayıcı
  olarak doluyor.
- **Boss ve elit tintleri güçlendirildi.** Roster'ın paleti koyu kahve ve gri;
  kâğıtta altın görünen çarpan koyu kahveyi biraz daha az koyu kahve yapıyordu
  ve 400 kişilik kalabalıkta 87 elit tek tek seçilemiyordu. Boss ise 3.1
  ölçekte okunamayan siyah bir kütleydi.
- **Boss despawn'dan muaf.** Uzaklaşan düşmanları temizleyen kural bossu da
  siliyordu, ve boss "bir kez salındı" diye işaretlendiği için geri gelmiyordu:
  yürüyerek dövüşü silmek mümkündü.
- **`?start=SANIYE` eklendi.** Geç roster'ı veya bossu görmek için 10 dakika
  oynamak zorunda kalmamak için. `?enemies=N` artık kalabalığı tabloyu ezerek
  sabitliyor (kare bütçesi ölçümü için).
- **Yürüme döngüsü gerçek hıza bağlandı.** Sabit çevrim sayısı, koşarak gelen
  bossun kaydığı izlenimi veriyordu.

**Kalan okunabilirlik sorunu:** 500+ gövdede koyu paletli yaratıklar üst üste
binince tek bir siyah kütleye dönüşüyor. Elit ve boss tintleri bunu kendi
içinde çözüyor, ama sıradan düşmanların birbirinden ayrılması bir palet
geçişi gerektiriyor — Faz 8'in cila kalemi.

---

### Faz 7 — Kabuk, UI ve oyun akışı · ✅ tamamlandı

- [x] Ana menü (başlık, başla, nasıl oynanır, ayarlar)
- [x] Duraklat — Esc / P, kol çubuğunda Start, mobilde HUD düğmesi
- [x] Ölüm ekranı ve run özeti (Faz 6'da geldi)
- [x] HUD: can, XP çubuğu, süre + **silah/eşya ikonları**
- [x] İkonlar voxel modellerden **render edilerek** üretiliyor (ayrı asset yok)
- [x] Ayarlar: dil, ekran sarsıntısı, hasar sayıları, kalite kademesi
- [x] Tuş atamaları, kol çubuğu tam desteği (sol çubuk + d-pad + Start)
- [x] Türkçe/İngilizce lokalizasyon altyapısı — ve iki dil de dolu

**Çıkış kriteri durumu:** Oyun artık kendini tanıtarak açılıyor: başlık, "nasıl
oynanır", sonra run. Duraklatılabiliyor, ayarları değiştirilebiliyor, bırakılıp
menüye dönülebiliyor — masaüstünde, kolda ve telefonda. Tarayıcıda doğrulandı:
menüde saat donuk, duraklatınca donuk, devam edince akıyor; ayarlar reload'dan
sağ çıkıyor; yeniden atanan tuş anında geçerli oluyor. Bir yabancının açıklamasız
bir run tamamlayıp tamamlayamayacağı hâlâ senin doğrulaman gereken kısım.

**Plandan sapmalar** (gerekçeleriyle):

- **`localStorage` bu faza çekildi** (plana göre Faz 8). Kapatıldığında bir
  sonraki açılışta geri gelen bir "ekran sarsıntısını kapat" ayarı, ayar değil;
  erişilebilirlik gerekçesiyle konan bir anahtarın kalıcı olmaması onu işlevsiz
  bırakıyordu. Depolama gizli sekmede erişilmeye çalışıldığında hata fırlatıyor,
  o yüzden okuma da yazma da sessizce varsayılana düşüyor: bir tercihi kaybetmek
  oyuncunun içinde olduğu run'dan daha ucuz.
- **Karakter seçim ekranı yok.** Tek karakter var; "iskeleti hazır" bir seçim
  ekranı, seçenek eklendiğinde nasıl olsa yeniden yazılacak boş bir ekrandır.
- **Yeniden başlatma sayfayı yeniliyor.** Her havuzun, her RNG akışının ve her
  katmanın ayrı sıfırlama yolu olması gerekirdi; atlanan tek bir alan, önceki
  run'ın kalabalığıyla başlayan bir run demek. Paket zaten önbellekte.
- **Mobil duraklat düğmesi eklendi.** Telefonda Esc tuşu yok; onsuz run'ın en
  zor bırakıldığı platformda bırakma yolu hiç yoktu. Doğrulama sırasında çıktı.
- **Silah/düşman isimleri string tablosuna girmedi.** Onlar `data/balance/*.json`
  içinde sayılarının yanında duruyor: Yatağan'ı yeniden adlandırmak bir denge
  tablosu düzenlemesi, çeviri değil.

**Yol boyunca bulunan iki hata:**

- **Kalite kademesi hedefi _yükseltiyordu_.** "Düşük" seçmek ilk dakikayı 55
  gövdeden 140'a çıkarıyordu, çünkü tavan ile hedef aynı parametreye
  bağlanmıştı. Bunlar iki ayrı araç: `?enemies=` tabloyu _değiştirir_ (seçilen
  bir sayıyı ölçmek için), kalite tavanı yalnızca _düşürür_ (telefonu korumak
  için). `effectiveTarget` ayrımı yapıyor, test de tutuyor.
- **Tuş atama boşta bırakabiliyordu.** İlk halim, tuşu çalınan eylemin eski
  tuşlarını geri veriyordu — yani engellemeye çalıştığı çift atamayı üretiyordu.
  Doğrusu takas: tuşunu kaybeden eylem, hedefin bıraktıklarını alıyor. Böylece
  hiçbir eylem tuşsuz kalmıyor ve hiçbir tuş iki işe bakmıyor.

---

### Faz 8 — Ses, cila, yayın · ✅ tamamlandı

- [x] Ses: WebAudio, tamamen sentezlenmiş efektler; mehter esinli döngüsel
      müzik. Ses havuzu ile eşzamanlı ses sayısı sınırlı
- [x] Cila: vinyet. **Bloom eklenmedi** — gerekçe aşağıda
- [x] Mobil: dokunmatik çubuk (Faz 2), otomatik kalite tahmini
- [x] Kayıt: `localStorage` ile ayarlar (Faz 7) + en iyi süre
- [x] Playwright smoke testi: build'i aç, oyna, hata yokluğunu doğrula
- [x] README: ekran görüntüleri, oynanış, bilinen sınırlar
- [ ] itch.io yayını / GitHub Pages canlı demo — **sende bekliyor**

**Çıkış kriteri durumu:** Paylaşılabilir bir build var ve tek dosyaya
paketlenip doğrulandı. Canlı link, Pages'in tek seferlik el işi yapılana kadar
eksik — `GITHUB_TOKEN` bir Pages sitesi oluşturamıyor.

**Sesin nasıl kurulduğu:** Her ses oscillator ve filtreden üretiliyor,
modellerle aynı gerekçeyle: indirilecek binary yok. Asıl zor kısım sentez
değil, _hız_: altı silah kalabalık bir sürüye saniyede yüzlerce vuruş
indiriyor ve her vuruşa bir tık çalan oyun, hiçbir bilgi taşımayan düz bir
uğultu üretir — hasar sayılarının aynı hatası, başka bir duyuda. Her sesin bir
asgari aralığı var ve o aralığın içinde gelen düşürülüyor, kuyruğa alınmıyor.
Aralıklar da eşit değil: vuruş arka plan dokusu, seviye atlama dakikada bir
olur ve asla kaçırılmamalı.

Müzik zamanlanıyor, döngüye alınmıyor. `setTimeout` onlarca milisaniye
kayıyor ve dinleyici bunu anında tökezleme olarak duyuyor; WebAudio'nun saati
kaymıyor. Ölçüler biraz önden yerleştiriliyor, render döngüsü sadece kuyruğu
dolduruyor. Ritim davulun _düm-tek_'i, makam Hicaz — ikinci ve üçüncü derece
arasındaki artık ikili, tüm tadın asıldığı aralık — ve solo, zurna yerine dar
bir bandpass'tan geçen vibratolu testere dişi.

**Plandan sapmalar** (gerekçeleriyle):

- **Bloom yok.** Plan "hafif bloom, vinyet" diyordu ve "pahalı efektlerden
  kaçın" diye ekliyordu; ikisi bu projede çelişiyor. Gerçek bir bloom zinciri
  kare başına birkaç ek render target ve geçiş demek, ve bu ortamda GPU
  olmadığı için o maliyeti _ölçemiyorum_. Tamamen kare bütçesi üzerine kurulu
  bir oyuna ölçemediğim bir maliyeti eklemek yanlış olurdu. Vinyet bir DOM
  katmanı olarak çiziliyor — bedava, ve işin yarısını gerçekten yapıyor.
  Parlama yerine zaten additive çizilen mermi, aura ve boss halkası çalışıyor.
- **Kalite kademesi tahmin ediliyor ama dayatılmıyor.** Çekirdek sayısı kaba
  bir gösterge, ama tarayıcının bir kare harcamadan verdiği tek sinyal. Yalnız
  hiçbir şey kaydedilmemişken kullanılıyor: oyuncu bir kademe seçtiği an o
  kademe onundur.
- **Düşman paletleri yeniden değerlendi** (Faz 6'dan devreden kalem). Sorun hiç
  renk tonu değildi — beş yaratık zaten beş ayrı tondaydı. *Değer*di: hepsi
  aynı orta-koyu bantta yaşıyordu, ve beş yüz gövde üst üste bindiğinde tek bir
  siyah kütleye ortalanıyordu.
- **itch.io atlandı.** Pages linki henüz yokken ikinci bir yayın hedefi eklemek,
  çalışmayan bir şeyi iki yere koymak olurdu.

**Yol boyunca bulunan hata:** Kalite tavanı `?enemies=` ölçüm bayrağını da
kısıyordu. Faz 7'de tavan ile hedefi ayırmıştım, ama tavanı override'a da
uygulamıştım — yani "600 düşmanda kare maliyetini ölç" diyen bir istek, düşük
kademeli bir cihazda sessizce 140'a düşüyor ve ölçüm yalan söylüyordu. Artık
açık override her ikisini de eziyor.

---

## 4. MVP Sonrası (kapsam dışı, kayıt için)

Bunlar bilinçli olarak MVP'den çıkarıldı — MVP'yi şişirmeden ileriye not:

- Meta-progression: kalıcı altın yükseltmeleri, kilit açma
- Silah evolüsyonları (silah max + eşleşen pasif → birleşik silah)
- 2. ve 3. karakter (farklı başlangıç silahı ve pasif eğilimi)
- 2. harita (farklı zemin, düşman havuzu, çevre tehlikesi)
- Achievement sistemi
- Skor tablosu (backend gerekir)
- Endless mod

---

## 5. Dosya Yapısı

```
src/
  main.ts                 # giriş noktası, sahne seçici (?scene=)
  core/
    loop.ts               # sabit adımlı döngü + interpolasyon
    input.ts              # klavye / gamepad / dokunmatik
    pool.ts               # generic object pool
    rng.ts                # tohumlanabilir RNG (run tekrarlanabilirliği)
  sim/                    # THREE import ETMEZ — tamamen test edilebilir
    world.ts              # simülasyon durumu (SoA buffer'lar)
    player.ts
    enemies.ts
    projectiles.ts
    weapons/              # silah başına bir dosya, ortak arayüz
    damage.ts             # hasar boru hattı
    spatial.ts            # uniform grid hash
    progression.ts        # XP, level-up, kart havuzu
    director.ts           # dalga zaman çizelgesi
  render/
    scene.ts              # kamera, ışık, zemin
    voxel/
      schema.ts           # JSON model tipleri
      builder.ts          # JSON -> BufferGeometry
      animator.ts         # prosedürel uzuv rotasyonu
      instanced.ts        # InstancedMesh yönetimi
    fx/                   # hasar sayıları, parçacıklar, sarsıntı
  ui/                     # DOM overlay (canvas değil — daha basit, erişilebilir)
  audio/
data/
  models/                 # *.json voxel tanımları
  balance/                # silah/düşman/dalga tabloları (JSON)
tests/                    # sim/ birim testleri + Playwright smoke
```

**Neden `data/balance/` ayrı:** Denge ayarı iterasyonun %80'i olacak. Kod
değişikliği gerektirmeden tablo düzenlemek, oyunu oynanabilir hale getiren
şeydir.

---

## 6. Risk Kaydı

| Risk                                       | Etki   | Azaltma                                                               |
| ------------------------------------------ | ------ | --------------------------------------------------------------------- |
| Sürü performansı web'de yetmez             | Kritik | Faz 3 erken ve tam bütçe kontrolüyle; SoA + instancing baştan         |
| Prosedürel animasyon cansız durur          | Yüksek | Faz 1 debug sahnesinde erken görsel doğrulama; squash/stretch         |
| Denge sıkıcı çıkar (build çeşitliliği yok) | Yüksek | Faz 5'ten sonra her faz sonunda tam run oyna; tablolar veri olarak    |
| Kapsam kayması (özellik ekleme isteği)     | Yüksek | MVP sonrası listesi yukarıda; yeni fikir oraya yazılır, MVP'ye girmez |
| Mobil web performansı                      | Orta   | Kalite kademesi + düşman limiti; mobil MVP'de "çalışıyor" yeterli     |
| Ses varlıkları                             | Düşük  | Prosedürel/ücretsiz SFX; müzik en sona bırakıldı                      |

---

## 7. Çalışma Düzeni

- **Branch:** `claude/yeniceeri-vampire-survivors-game-51qjs6`, her faz için
  draft PR
- **Faz teslimi:** çalışan build + testler yeşil + performans bütçesi
  doğrulanmış. Yarım sistem teslim edilmez.
- **Her faz sonunda oyunu gerçekten oyna.** Bu tür oyunlarda metrikler
  eğlenceyi ölçmez.
- **Commit:** küçük ve konu odaklı; `feat(sim):`, `perf(render):` gibi prefix

---

## 8. Sıradaki Adım

**MVP tamam.** Faz 0'dan 8'e kadar hepsi bitti; her fazın sapmaları kendi
bölümünde gerekçesiyle kayıtlı. 495 birim testi ve 4 uçtan uca smoke testi
yeşil.

**Sende bekleyenler:**

- **GitHub Pages'i aç** (Settings → Pages → Source: GitHub Actions).
  `GITHUB_TOKEN` bir Pages sitesi _oluşturamıyor_, sadece var olana deploy
  edebiliyor. Bu yapılana kadar canlı link yok.
- **Gerçek donanımda FPS.** Bu repoda hiç ölçülmedi ve ölçülemez: ortamda GPU
  yok, headless Chromium SwiftShader ile yazılımdan çiziyor. `?enemies=800`
  ile açıp overlay'deki "worst" değerine bakman gereken tek şey bu.
- **Öznel geri bildirim:** hareket hissi, build çeşitliliği, zorluk eğrisi ve
  sesin ses seviyesi. Metrikler bunların hiçbirini ölçmez.

**MVP sonrasına devreden kalem yok** — Faz 6'da açtığım okunabilirlik kalemi
Faz 8'de kapandı. Yeni fikirler § 4'e yazılır.
