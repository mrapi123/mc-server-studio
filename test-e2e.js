/* Uçtan uca test: modpack ara -> sunucu kur -> başlat -> "Done" bekle -> durdur.
   Çalıştırma: npx electron test-e2e.js */
const { app } = require('electron');
const path = require('path');
const os = require('os');

app.setPath('userData', path.join(os.tmpdir(), 'mc-server-studio-e2e'));

const modrinth = require('./src/main/modrinth');
const instances = require('./src/main/instances');
const loaders = require('./src/main/loaders');
const serverproc = require('./src/main/serverproc');

function log(...args) {
  console.log('[E2E]', ...args);
}

async function run() {
  log('userData:', app.getPath('userData'));

  // 1) Arama
  const packs = await modrinth.searchPacks('simply optimized');
  log('Arama sonucu:', packs.slice(0, 3).map((p) => p.name).join(' | '));
  const pack = packs.find((p) => p.name.toLowerCase().includes('simply optimized')) || packs[0];
  log('Seçilen pack:', pack.name, pack.id);

  // 2) Kurulum
  const inst = await instances.createInstance(
    {
      source: 'modrinth',
      projectId: pack.id,
      name: 'e2e-test',
      memoryMb: 2048,
      eulaAccepted: true,
      packIcon: pack.icon
    },
    (msg) => log('  kurulum:', msg)
  );
  log('Kuruldu:', JSON.stringify({ mc: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion, java: inst.javaPath }));

  // 3) Başlatma argümanları
  const { args } = loaders.resolveLaunch(instances.serverDir(inst.id), 2048);
  log('Launch args:', args.join(' '));

  // 4) Sunucuyu başlat ve "Done" bekle
  serverproc.setNotifier((channel, data) => {
    if (channel === 'server:status-change') log('durum:', data.status);
  });
  let done = false;
  const origStart = await serverproc.start(inst.id);
  log('start():', JSON.stringify(origStart));

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sunucu 8 dakikada açılmadı')), 8 * 60 * 1000);
    const iv = setInterval(() => {
      const buf = serverproc.consoleBuffer(inst.id);
      if (!done && /Done \(/.test(buf)) {
        done = true;
        clearTimeout(timeout);
        clearInterval(iv);
        resolve();
      }
      if (serverproc.status(inst.id) === 'stopped' && !done) {
        clearTimeout(timeout);
        clearInterval(iv);
        reject(new Error('Sunucu erken kapandı:\n' + buf.slice(-3000)));
      }
    }, 2000);
  });
  log('SUNUCU AÇILDI! Durduruluyor...');

  await serverproc.stop(inst.id);
  log('Sunucu durdu. Temizlik...');
  await instances.deleteInstance(inst.id);
  log('BAŞARILI');
  app.exit(0);
}

app.whenReady().then(() =>
  run().catch((err) => {
    console.error('[E2E] HATA:', err.message);
    app.exit(1);
  })
);
