# Katkıda bulunma

Teşekkürler! Küçük, odaklı değişiklikler tercih edilir.

## Geliştirme

```bash
npm install
npm start
```

Ana süreç `src/main/`, arayüz `renderer/`. IPC kanalı ekliyorsan hem `src/main/ipc.js` hem `src/preload.js` hem de `renderer/app.js` güncellenmeli.

## Test

Değişikliğine uygun olanı çalıştır:

```bash
npm run test:smoke
npm run test:players
```

Loader / kurulum dokunuyorsan `npm run test:e2e` veya `npm run test:cf` da koş.

## Pull request

- Tek bir konu (ör. "görüş mesafesi stepper'ı")
- Türkçe kullanıcı metinleri, İngilizce kod tanımlayıcıları
- Gereksiz bağımlılık ekleme
