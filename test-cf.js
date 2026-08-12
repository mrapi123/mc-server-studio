/* CurseForge manifest kurulum yolu testi. Çalıştırma: npx electron test-cf.js */
const { app } = require('electron');
const path = require('path');
const os = require('os');

app.setPath('userData', path.join(os.tmpdir(), 'mc-server-studio-e2e'));

const curseforge = require('./src/main/curseforge');
const instances = require('./src/main/instances');
const loaders = require('./src/main/loaders');
const serverproc = require('./src/main/serverproc');

const log = (...a) => console.log('[CF-E2E]', ...a);

async function run() {
  const MOD_ID = 1490741; // Satisfaction Guaranteed (küçük Fabric paketi, server pack yok)
  const files = await curseforge.getPackVersions(MOD_ID);
  log('Dosyalar:', files.slice(0, 3).map((f) => `${f.id}:${f.name}`).join(' | '));

  const inst = await instances.createInstance(
    {
      source: 'curseforge',
      projectId: MOD_ID,
      fileId: files[0].id,
      name: 'cf-test',
      memoryMb: 2048,
      eulaAccepted: true
    },
    (msg) => log('  kurulum:', msg)
  );
  log('Kuruldu:', JSON.stringify({
    mc: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion,
    java: inst.javaPath, failedMods: (inst.failedMods || []).length
  }));

  const { args } = loaders.resolveLaunch(instances.serverDir(inst.id), 2048);
  log('Launch args:', args.join(' '));

  serverproc.setNotifier((ch, d) => ch === 'server:status-change' && log('durum:', d.status));
  await serverproc.start(inst.id);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('8 dakikada açılmadı')), 8 * 60 * 1000);
    const iv = setInterval(() => {
      const buf = serverproc.consoleBuffer(inst.id);
      if (/Done \(/.test(buf)) {
        clearTimeout(timeout); clearInterval(iv); resolve();
      } else if (serverproc.status(inst.id) === 'stopped') {
        clearTimeout(timeout); clearInterval(iv);
        reject(new Error('Erken kapandı:\n' + buf.slice(-3000)));
      }
    }, 2000);
  });
  log('SUNUCU AÇILDI! Durduruluyor...');
  await serverproc.stop(inst.id);
  await instances.deleteInstance(inst.id);
  log('BAŞARILI');
  app.exit(0);
}

app.whenReady().then(() =>
  run().catch((err) => {
    console.error('[CF-E2E] HATA:', err.message);
    app.exit(1);
  })
);
