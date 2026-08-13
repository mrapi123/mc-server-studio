# MC Server Studio

[![Lisans](https://img.shields.io/badge/lisans-MIT-22c55e.svg)](LICENSE)
[![Sürüm](https://img.shields.io/github/v/release/mrapi123/mc-server-studio?color=14b8a6)](https://github.com/mrapi123/mc-server-studio/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4.svg)](https://github.com/mrapi123/mc-server-studio/releases)

Modrinth ve CurseForge modpack'lerini indirip kendi bilgisayarında Minecraft sunucusu olarak kuran, üzerine ekstra mod ekleyebileceğin, Aternos tarzı ayarlara sahip masaüstü uygulaması.

**İndir:** [Son sürüm (v1.2.11)](https://github.com/mrapi123/mc-server-studio/releases/latest)

| Dosya | Ne işe yarar |
| --- | --- |
| `MC.Server.Studio.1.2.11.portable.exe` | Kurulum yok, çift tıkla çalışır |
| `MC.Server.Studio.Setup.1.2.11.exe` | Kurulum sihirbazı, Başlat menüsüne ekler |

Windows SmartScreen uyarısında **Ek bilgi → Yine de çalıştır** de (uygulama imzasızdır).

---

## Özellikler

- **Mod / modpack arama** — Modrinth ve CurseForge; yazılabilir arama kutuları, boş sonuçta filtre genişletme / CurseForge yedek arama
- **Tek tıkla kurulum** — Forge / NeoForge / Fabric / Quilt / vanilla; CurseForge'da server pack varsa onu kullanır
- **İstemci senkronu** — Server pack eksik kaldığında istemci paketinden kalan modları tamamlar (ör. 353 → 469)
- **Resource pack** — Paketteki uygun resource pack'i yerel HTTP ile oyunculara sunar (Xaero ikon / saf datapack elenir)
- **Güvenli atlama** — Sunucuyu düşüren render modları (Sodium, Iris/Oculus, colorwheel, subtle_effects, stop_rendering…) indirilmez / temizlenir; animasyon/UI kanalı modları (watut, wakes vb.) korunur
- **Otomatik Java** — Mojang meta verisine göre gereken sürümü bulur, yoksa Temurin JRE indirir
- **Ekstra mod** — Modrinth/CurseForge'dan ara veya `.jar` dosyası ekle, aç/kapat, sil
- **Konsol** — Canlı renkli log, komut gönderme, ↑↓ geçmiş
- **Oyuncular** — Çevrimiçi liste (kick/ban), whitelist, OP, giriş/çıkış kayıtları
- **Görüş & chunk** — `view-distance` ve `simulation-distance` için +/- butonları ve hazır profiller (Potato → Ultra)
- **Dünya ayarları** — Seed, dünya tipi, yapılar, hardcore, spawn, Nether, uçuş, komut bloğu, dünya sıfırlama
- **Bağlantı** — LAN ve genel IP:port, kopyala butonu, port yönlendirme adımları
- **Dosyadan içe aktar** — `.mrpack` veya CurseForge `.zip`

---

## Klasör yapısı

```
mc-server-studio/
├── src/
│   ├── main/                 # Electron ana süreç
│   │   ├── main.js           # Pencere
│   │   ├── ipc.js            # Arayüz ↔ süreç köprüsü
│   │   ├── instances.js      # Sunucu kurulumu / istemci senkronu / dünya sıfırlama
│   │   ├── loaders.js        # Forge / Fabric / Quilt / NeoForge
│   │   ├── modrinth.js       # Modrinth API
│   │   ├── curseforge.js     # CurseForge API (curse.tools + paralel/batch)
│   │   ├── resourcepack.js   # Resource pack yayını + hard-crash mod filtresi
│   │   ├── java.js           # Java keşfi ve indirme
│   │   ├── serverproc.js     # Java süreci, konsol, oyuncu takibi
│   │   ├── players.js        # Whitelist / OP / kayıtlar
│   │   ├── mods.js           # Mod ve server.properties
│   │   ├── network.js        # LAN + genel IP
│   │   ├── settings.js       # Uygulama ayarları
│   │   └── util.js
│   └── preload.js            # Güvenli IPC yüzeyi
├── renderer/                 # Arayüz (HTML / CSS / JS)
├── tests/                    # Smoke + uçtan uca testler
├── scripts/                  # GitHub yayınlama betikleri
├── LICENSE
├── README.md
├── CONTRIBUTING.md
└── package.json
```

Sunucu dosyaları `%APPDATA%/MC Server Studio/instances/` altında tutulur (uygulamadaki klasör butonuyla açılır).

---

## Geliştirme

Gereksinimler: Node.js 18+, Windows.

```bash
git clone https://github.com/mrapi123/mc-server-studio.git
cd mc-server-studio
npm install
npm start
```

Electron indirme sorunu yaşarsan:

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

### Testler

```bash
npm run test:smoke      # Dış API erişimi
npm run test:players    # Whitelist / OP / ağ
npm run test:e2e        # Modrinth paketi kur + sunucu aç
npm run test:cf         # CurseForge paketi kur + sunucu aç
npm run test:vanilla    # Vanilla sunucu
```

### Exe paketleme

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

`dist/` klasöründe NSIS kurulum ve portable exe üretilir.

`winCodeSign` sembolik link hatası alırsan Windows Geliştirici Modu'nu aç veya arşivi
`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` klasörüne elle aç
(macOS link hataları yok sayılabilir).

Yayınlamak için: `scripts/publish-release.ps1` (GitHub token gerekir).

---

## Arkadaşların nasıl bağlanır?

| Durum | Ne yapmalılar |
| --- | --- |
| Aynı ev / Wi-Fi | **Bağlantı** sekmesindeki LAN adresi (`192.168.x.x:25565`) |
| Başka ev / internet | Genel IP:port — ama önce modemde **25565 TCP** port yönlendirme şart |

Port yönlendirme yapamıyorsan [playit.gg](https://playit.gg) gibi ücretsiz tünel kullanılabilir.

---

## Ayarlar özeti

| Ayar | Nerede | Not |
| --- | --- | --- |
| Görüş mesafesi (3–32) | Ayarlar → Görüş & Chunk | Oyuncuya gönderilen chunk yarıçapı |
| Simülasyon mesafesi (3–32) | Ayarlar → Görüş & Chunk | Mob / ekin / redstone işlenen yarıçap |
| Seed, dünya tipi | Ayarlar → Dünya | Sadece **yeni** dünyaya uygulanır |
| Hardcore, Nether, yapılar, spawn | Ayarlar → Dünya | Yeniden başlatınca uygulanır |
| Dünyayı sıfırla | Ayarlar → Dünya | Sunucu kapalıyken; kalıcı siler |
| RAM, Java, EULA | Ayarlar → Sunucu | |
| Port, MOTD, zorluk, PvP, online-mode | Ayarlar → server.properties | |
| Whitelist / OP | Oyuncular sekmesi | |

Hazır chunk profilleri: Potato (4/4), Dengeli (8/6), Varsayılan (10/10), Yüksek (16/12), Ultra (32/16).

---

## Notlar

- Bazı CurseForge modları üçüncü taraf indirmeye kapalıdır; kurulum sonunda uyarı olarak listelenir, elle eklenebilir.
- CurseForge API anahtarı isteğe bağlıdır (Ayarlar). Boşsa `api.curse.tools` kullanılır; anahtar varsa batch API ile daha hızlı senkron.
- Server pack + istemci senkronu büyük paketlerde (Better MC, Soulrend vb.) eksik mod / “mismatched mod channel” sorununu azaltır.
- Katkı için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bak.

Lisans: [MIT](LICENSE)
