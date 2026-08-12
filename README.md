# MC Server Studio

Modrinth ve CurseForge modpack destekli, kendi bilgisayarında Minecraft sunucusu kurup yönetmeni sağlayan açık kaynak masaüstü uygulaması.

[![Release](https://img.shields.io/github/v/release/mrapi123/mc-server-studio)](https://github.com/mrapi123/mc-server-studio/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## İndir

En güncel Windows exe: **[Releases](https://github.com/mrapi123/mc-server-studio/releases)**

- `MC.Server.Studio.*.portable.exe` — kurulum gerektirmez, çift tıkla çalıştır
- `MC.Server.Studio.Setup.*.exe` — kurulum sihirbazı

> Windows SmartScreen uyarısında **Ek bilgi → Yine de çalıştır** seç (uygulama imzasızdır).

## Özellikler

| Bölüm | Ne yapar |
| --- | --- |
| Modpack kurulum | Modrinth / CurseForge arama, `.mrpack` / `.zip` içe aktarma |
| Loader | Forge, NeoForge, Fabric, Quilt, vanilla — otomatik kurulum |
| Java | Gereken sürümü tespit eder, yoksa Temurin indirir |
| Modlar | Pack üzerine ekstra mod ara/ekle, jar ekle, aç/kapat, sil |
| Konsol | Canlı renkli log, komut geçmişi (↑↓), başlat/durdur |
| Oyuncular | Çevrimiçi liste, kick/ban, whitelist, OP, giriş/çıkış kayıtları |
| Bağlantı | LAN + genel IP:port, kopyala, port yönlendirme adımları |
| Dünya | Seed, tip, hardcore, spawn, nether, uçuş, komut bloğu, sıfırla |
| Performans | Görüş mesafesi + chunk simülasyon mesafesi (+/− ve hazır profiller) |

## Görüş & Chunk ayarları

Ayarlar sekmesindeki **Görüş & Chunk Performansı** kartından:

- **view-distance** — oyuncuya gönderilen chunk yarıçapı (render)
- **simulation-distance** — mob / ekin / redstone işlenen chunk yarıçapı

Hazır profiller: Potato (4/4), Dengeli (8/6), Varsayılan (10/10), Yüksek (16/12), Ultra (32/16). Aralık 3–32. Değişiklik sunucu yeniden başlatılınca uygulanır.

## Geliştirme

```bash
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
npm run test:smoke     # dış API erişimi
npm run test:props     # server.properties / chunk / dünya
npm run test:players   # whitelist, OP, ağ
npm run test:e2e       # Modrinth kurulum + sunucu açılışı
npm run test:cf        # CurseForge kurulum + sunucu açılışı
```

### Exe paketleme

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

Çıktı: `dist/`

## Proje yapısı

```
mc-server-studio/
├── src/
│   ├── main/          # Electron ana süreç (API, kurulum, sunucu)
│   └── preload.js     # Güvenli IPC köprüsü
├── renderer/          # Arayüz (HTML/CSS/JS)
├── tests/             # Smoke + e2e testler
├── scripts/           # GitHub yayın betikleri
├── package.json
├── LICENSE
└── README.md
```

## Notlar

- Sunucu dosyaları: `%APPDATA%/mc-server-studio/instances/`
- Bazı CurseForge modları üçüncü taraf indirmeye kapalı olabilir; elle eklenebilir
- İnternetten bağlanmak için modemde port yönlendirme (varsayılan 25565) gerekir
- Seed / dünya tipi yalnızca **yeni** dünyaya uygulanır — mevcut dünyayı silmek için Ayarlar → Dünyayı Sıfırla

## Lisans

[MIT](LICENSE)
