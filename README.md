# MC Server Studio

Modrinth ve CurseForge modpack destekli, kendi bilgisayarında Minecraft sunucusu kurup yönetmeni sağlayan masaüstü uygulaması.

## Özellikler

- **Modpack arama**: Modrinth ve CurseForge'da modpack ara (CurseForge için API anahtarı gerekmez; istersen Ayarlar'dan kendi anahtarını girebilirsin).
- **Tek tıkla sunucu kurulumu**: Seçtiğin modpack sürümünü indirir, sunucu dosyalarını hazırlar. CurseForge paketlerinde hazır "server pack" varsa otomatik onu kullanır.
- **Loader desteği**: Forge, NeoForge, Fabric, Quilt ve vanilla sunucuları otomatik kurar.
- **Otomatik Java**: Gereken Java sürümünü Mojang meta verisinden okur; sistemde yoksa Temurin JRE'yi otomatik indirir.
- **Ekstra mod ekleme**: Kurulu sunucuya Modrinth/CurseForge'dan uyumlu mod arayıp ekleyebilir, `.jar` dosyasını elle ekleyebilir, modları devre dışı bırakabilir veya silebilirsin.
- **Konsol**: Canlı, renkli sunucu konsolu; komut gönderme (↑↓ ile komut geçmişi), başlat/durdur.
- **Oyuncu yönetimi**: Çevrimiçi oyuncu listesi (at/yasakla), beyaz liste (whitelist) aç/kapat ve isim ekleme (online modda Mojang'dan, offline modda deterministik UUID), OP yetkisi verme, oyuncu giriş/çıkış kayıtları.
- **Bağlantı sekmesi**: Arkadaşlarının bağlanacağı yerel (LAN) ve genel (internet) IP:port adreslerini kopyalanabilir şekilde gösterir; port yönlendirme adımlarını anlatır.
- **Ayarlar**: RAM, Java yolu, EULA, `server.properties` (port, MOTD, zorluk, online-mode, PvP...).
- **Dosyadan içe aktar**: `.mrpack` veya CurseForge modpack `.zip` dosyasından kurulum.

## Kurulum (geliştirme)

```bash
npm install
npm start
```

Not: Electron indirme sorunu yaşarsan `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` ortam değişkeniyle `npm install` çalıştır.

## Exe olarak paketleme

```bash
npm run dist
```

`dist/` klasöründe hem kurulum sihirbazlı (NSIS) hem de taşınabilir (portable) `.exe` üretilir.

İndirme sorunlarında şu ortam değişkenleri yardımcı olur:

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

`winCodeSign` sembolik link hatası alırsan ya Windows Geliştirici Modu'nu aç ya da arşivi
`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` klasörüne elle aç (macOS link hataları yok sayılabilir).

## Testler

- `node smoke-test.js` — kullanılan dış API'lerin (Modrinth, CurseForge proxy, Fabric meta, Adoptium) erişilebilirliğini kontrol eder.
- `npx electron test-e2e.js` — Modrinth'ten küçük bir modpack kurup sunucuyu gerçekten açar ve kapatır.
- `npx electron test-cf.js` — CurseForge manifest yolu için aynı testi yapar.

## Notlar

- Sunucu dosyaları `%APPDATA%/mc-server-studio/instances/` altında tutulur (uygulamadaki 📁 butonuyla açılır).
- Bazı CurseForge modları üçüncü taraf indirmeye kapalıdır; bunlar kurulum sonunda uyarı olarak listelenir ve elle eklenebilir.
- İnternete açmak için router'ında sunucu portunu (varsayılan 25565) yönlendirmen gerekir.
