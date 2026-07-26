# Janissary Survivor — Yol Haritası

> Yeniçeri konseptli, fantastik/mitolojik Osmanlı temalı, Vampire Survivors
> mekaniklerine dayanan 3D tarayıcı oyunu.

---

## 1. Sabitlenen Kararlar

Bu kararlar roadmap'in temelini oluşturur; değişirlerse fazlar yeniden
değerlendirilmelidir.

| Konu | Karar | Gerekçe |
|---|---|---|
| Hedef platform | **Web** (masaüstü tarayıcı öncelikli, mobil web "nice to have") | Dağıtım maliyeti sıfır, iterasyon hızlı |
| Render | **Three.js + TypeScript + Vite** | En hafif bundle, `InstancedMesh` ile kalabalık sürü kontrolü, tam kontrol |
| Modeller | **Prosedürel voxel** — JSON tanım + kod builder | Binary asset yok, git-diff okunabilir, rigging gereksiz |
| Kamera | **Top-down, hafif eğimli ortografik** (~55° pitch) | Sürü okunabilirliği + 3D görsellik; çarpışma XZ düzleminde 2D kalır |
| Tema | **Fantastik/mitolojik Osmanlı** | Yaratıcı alan geniş, tarihsel hassasiyet riski yok |
| MVP | Tek harita, 15 dakikalık run, meta-progression yok | Gerçekçi dikey dilim |

### Neden voxel bu proje için doğru karar

Minecraft tarzı blok estetiği burada estetik bir tercihten fazlası:

- **Asset riski yok** — modeller `data/models/*.json` içinde veri olarak yaşar,
  kod bunları merged `BufferGeometry`'ye çevirir. Repo boyutu ~0, indirilecek
  `.glb` yok.
- **Rigging yok** — animasyon uzuvları pivot noktasından döndürmekle olur
  (yürüme = bacak salınımı, saldırı = kol yayı). Tam Minecraft mantığı.
- **Performans bedava** — tüm düşmanlar tek `InstancedMesh` ile çizilir, çünkü
  hepsi aynı geometriyi paylaşır. Renk varyasyonu instance attribute ile.
- **Kimlik net okunur** — beyaz *börk*, kırmızı kaftan, yatağan silueti blok
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

| Metrik | Hedef |
|---|---|
| FPS @ 800 düşman | ≥ 60 (orta seviye laptop, entegre GPU) |
| FPS @ 300 düşman | ≥ 60 (mobil web) |
| Draw call | < 60 |
| Frame başına heap tahsisi | ~0 (sıcak döngüde) |
| Bundle (gzip) | < 2 MB |
| Boş ekrandan oynanabilire | < 2 sn |

---

## 3. Fazlar

Toplam tahmin: **5–6 hafta** (tek geliştirici, tam zamanlı benzeri tempo).
Her fazın sonunda çalışan, elle oynanabilir bir build olur — hiçbir faz
"yarım bırakılmış sistem" teslim etmez.

---

### Faz 0 — İskelet ve altyapı · ~2–3 gün

Oyun yok, ama her şeyin üzerine kurulacağı zemin var.

- Vite + TypeScript + strict mode kurulumu
- ESLint + Prettier, `npm run check` tek komutla tip + lint + test
- Vitest kurulumu, `src/sim/` için ilk saçma-basit test (pipeline'ın çalıştığını
  kanıtlamak için)
- Sabit adımlı ana döngü (`accumulator` pattern), interpolasyonlu render
- Boş sahne: ortografik kamera, ışık, zemin düzlemi, `Stats` FPS sayacı
- GitHub Actions: push'ta `npm run check` + build
- GitHub Pages'e otomatik deploy (`main` branch)

**Çıkış kriteri:** Boş yeşil zeminli sahne canlı URL'de açılıyor, CI yeşil.

---

### Faz 1 — Voxel model pipeline · ~4–5 gün

Projenin en ayırt edici teknik parçası. Erken çözülmeli, çünkü sonraki her
faz buna dayanacak.

- **JSON şeması:** her model bir palet + parça (`part`) listesi. Her parça:
  `{ name, pos, size, color, pivot, parent }`. Hiyerarşi uzuv animasyonunu
  mümkün kılar.
- **Builder:** JSON → parça başına merged `BufferGeometry`. Aynı renkteki
  yüzler tek materyalde birleşir; kamera görüş açısı sabit olduğu için
  görünmeyen yüzler kırpılır (yüz sayısı ~%40 düşer).
- **Animatör:** iskeletsiz, prosedürel uzuv rotasyonu. `walk`, `idle`,
  `attack`, `hit` (kısa flash + geri tepme), `death` (parçalara ayrılma).
- **Instancing katmanı:** aynı modelden N örnek → tek `InstancedMesh`,
  per-instance renk/matris. Animasyon fazı instance attribute'u olarak geçer
  ki her düşman aynı anda aynı ayağı atmasın.
- **Debug sahnesi:** `/?scene=models` ile tüm modelleri yan yana, animasyon
  seçiciyle gösteren geliştirici ekranı.
- İlk model: **yeniçeri** (börk, kaftan, yatağan) + bir test düşmanı.

**Çıkış kriteri:** Debug sahnesinde 1000 animasyonlu voxel figür 60 FPS'te
dönüyor, tek draw call.

**Risk:** Prosedürel animasyonun "cansız" görünmesi. Azaltma: squash/stretch
ve hafif gövde salınımı (bob) ekle — Minecraft'ın kendisi bunu yapmaz ama
top-down'da hareket hissi için gerekli.

---

### Faz 2 — Oyuncu, kamera, dünya · ~3–4 gün

- 8 yönlü hareket (WASD + oklar + gamepad sol analog), ivmesiz ve anında —
  VS'nin oynanış hissi kesin kontrole dayanır
- Kamera takibi: yumuşak lerp, ölü bölge (dead zone), hafif bakış-ileri kayması
- Harita: **Kırık Surlar** — sonsuz kaydırılan zemin (tiling), dekoratif
  voxel öğeler (sur parçaları, servi, kandil) sınırsız alanda dağılım
- Karakter animasyon durum makinesi: idle ↔ walk ↔ hit
- `?debug=1` ile geliştirici overlay: pozisyon, FPS, sayaçlar

**Çıkış kriteri:** Boş dünyada dolaşmak akıcı ve tatmin edici hissettiriyor.
(Bu subjektif kriter ciddiye alınmalı — burada iyi hissettirmiyorsa
düşman eklemek kurtarmaz.)

---

### Faz 3 — Düşman sürüsü ve performans · ~5–6 gün

Projenin teknik omurgası. Burada başarısız olursak konsept web'de yürümez.

- SoA düşman havuzu (sabit kapasite 2000, hiç `new` yok)
- Spawn sistemi: kamera görüş alanının hemen dışında, ekran kenarına dağılmış
- Yapay zeka: oyuncuya doğru yönel + **komşu itmesi** (separation) — üst üste
  binmeyi engeller, sürünün "kalabalık" hissini verir
- Uzamsal hash grid: düşman-oyuncu ve düşman-mermi sorguları O(1)
- Ölüm: parçalanma efekti, XP mücevheri (*cevher*) düşürme
- Instanced render, düşman tipi başına tek draw call

**Çıkış kriteri:** 800 düşman aynı anda kovalarken 60 FPS, Chrome
Performance panelinde GC sawtooth yok.

**Risk (en yüksek):** Separation davranışı O(n²)'e kaçabilir. Azaltma: grid
komşuluğu ile sınırla, düşman başına en fazla 8 komşu değerlendir. Faz sonunda
1500 düşmanla stres testi yap.

---

### Faz 4 — Silahlar ve hasar · ~5–6 gün

- Merci havuzu (SoA), çarpışma grid üzerinden
- Silah çerçevesi: `cooldown`, `damage`, `area`, `speed`, `amount`,
  `pierce`, `duration` — hepsi veri, davranış farkı sadece hedefleme/hareket
  fonksiyonunda
- Hasar boru hattı: temel hasar → çarpan → kritik → azaltma. `src/sim/` içinde,
  tamamen test edilmiş
- Vuruş geri bildirimi: hasar sayıları (instanced sprite), ekran sarsıntısı,
  hit-stop, düşman flash + geri tepme
- **6 silah** (MVP seti):

| Silah | Davranış |
|---|---|
| **Yatağan** | Oyuncunun etrafında yay çizen yakın dövüş — başlangıç silahı |
| **Tirkeş** (ok sadağı) | En yakın düşmanı hedefleyen otomatik oklar |
| **Mehter Davulu** | Periyodik halka şok dalgası, geri savurur |
| **Nazar Boncuğu** | Oyuncunun yörüngesinde dönen, delen boncuklar |
| **Şahi Topu** | Yay çizerek düşen patlayıcı gülle |
| **Kandil** | Oyuncuyu saran ateş aurası, sürekli hasar |

**Çıkış kriteri:** 6 silah aynı anda ateşlerken 800 düşmanla 60 FPS. Her
silah tek başına 5 dakika oynanabilir hissettiriyor.

---

### Faz 5 — Run içi ilerleyiş · ~4–5 gün

- XP / seviye eğrisi, level-up'ta oyun durur
- **Seçim ekranı:** 3–4 kart, ağırlıklı rastgele havuz, banish/reroll yok (MVP)
- Silah seviyeleri 1→8, her seviye veri tablosundan gelen bir stat artışı
- **8 pasif eşya:** Kalkan (zırh), Sekban Çizmesi (hız), Muska (bekleme
  süresi), Kandil Yağı (toplama menzili), Şerbet (yenilenme), Bileği Taşı
  (hasar), Dürbün (alan), Tılsım (mermi sayısı)
- Sandık / yerde toplanabilirler: cevher, altın, tavuk (can), mıknatıs
- Evolüsyon sistemi **MVP dışı** — Faz 8'e sonrası olarak not edildi

**Çıkış kriteri:** 15 dakikalık bir run baştan sona oynanabiliyor, build
çeşitliliği hissediliyor.

---

### Faz 6 — Dalga direktörü ve boss · ~4–5 gün

- Zaman çizelgesi tablosu: `t=0..15dk` arası dakika başına spawn kuralları
  (tip, oran, formasyon, elit şansı) — tamamen veri
- **5 düşman tipi:**

| Düşman | Rol |
|---|---|
| **Karakoncolos** | Temel kovalayıcı, kalabalık dolgusu |
| **Cin** | Hızlı, düzensiz zigzag hareket |
| **Gulyabani** | Yavaş, dayanıklı, büyük — sürüde duvar oluşturur |
| **Şahmeran Yavrusu** | Çok hızlı, dalgalı hat izler |
| **Alkarısı** | Mesafe koruyan menzilli saldırgan |

- Formasyonlar: halka kuşatma, duvar akını, tek yönlü kalabalık
- Elit varyantlar: instance rengi + stat çarpanı ile (yeni model gerekmez)
- **Boss: Gulyabani Ağası** (t=10dk mid-boss, t=15dk final) — 3 fazlı,
  telegraph'lı saldırılar
- Kazanma/kayıp durumu, run özet ekranı

**Çıkış kriteri:** Zorluk eğrisi ilk 3 dakikada kolay, 8. dakikada yoğun,
14. dakikada zorlayıcı. Kazanmak mümkün ama garanti değil.

---

### Faz 7 — Kabuk, UI ve oyun akışı · ~3–4 gün

- Ana menü, karakter seçim (tek karakter ama iskelet hazır), duraklat, ölüm
  ekranı, run özeti
- HUD: can, XP çubuğu, süre, öldürme sayısı, silah/eşya ikonları
- İkonlar voxel modellerden **render edilerek** üretilir (ayrı asset yok)
- Ayarlar: ses seviyeleri, ekran sarsıntısı kapatma, hasar sayıları kapatma,
  kalite kademesi (düşman limiti)
- Tuş atamaları, gamepad tam desteği
- Türkçe/İngilizce lokalizasyon altyapısı (string tablosu — çeviri sonra)

**Çıkış kriteri:** Bir yabancı, hiç açıklama olmadan oyunu açıp bir run
tamamlayabiliyor.

---

### Faz 8 — Ses, cila, yayın · ~4–5 gün

- Ses: WebAudio, prosedürel/ücretsiz SFX; mehter esinli döngüsel müzik.
  Ses havuzu ile aynı anda 50+ efekt kısılmadan çalar
- Post-processing: hafif bloom, vinyet — pahalı efektlerden kaçın
- Mobil: dokunmatik sanal joystick, otomatik kalite düşürme
- Kayıt: `localStorage` ile ayarlar + en iyi süre
- Playwright smoke testi: oyunu aç, 30 saniye headless oyna, FPS ve hata
  yokluğunu doğrula
- itch.io yayını, GitHub Pages canlı demo linki
- README: ekran görüntüleri, GIF, oynanış açıklaması

**Çıkış kriteri:** Paylaşılabilir bir link. MVP tamam.

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

| Risk | Etki | Azaltma |
|---|---|---|
| Sürü performansı web'de yetmez | Kritik | Faz 3 erken ve tam bütçe kontrolüyle; SoA + instancing baştan |
| Prosedürel animasyon cansız durur | Yüksek | Faz 1 debug sahnesinde erken görsel doğrulama; squash/stretch |
| Denge sıkıcı çıkar (build çeşitliliği yok) | Yüksek | Faz 5'ten sonra her faz sonunda tam run oyna; tablolar veri olarak |
| Kapsam kayması (özellik ekleme isteği) | Yüksek | MVP sonrası listesi yukarıda; yeni fikir oraya yazılır, MVP'ye girmez |
| Mobil web performansı | Orta | Kalite kademesi + düşman limiti; mobil MVP'de "çalışıyor" yeterli |
| Ses varlıkları | Düşük | Prosedürel/ücretsiz SFX; müzik en sona bırakıldı |

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

**Faz 0** — Vite + TS iskeleti, sabit adımlı döngü, CI ve GitHub Pages
deploy. Sonunda boş ama canlı bir sahne URL'i olur.

Onay verirsen başlıyorum.
