/* Vanilla kurulum smoke testi. npm run test:vanilla veya: npx electron tests/test-vanilla.js */
const { app } = require('electron');
const path = require('path');
const os = require('os');

app.setPath('userData', path.join(os.tmpdir(), 'mc-server-studio-vanilla'));

const instances = require('../src/main/instances');
const loaders = require('../src/main/loaders');
const serverproc = require('../src/main/serverproc');

const log = (...a) => console.log('[VANILLA]', ...a);

async function run() {
  const { latest } = await loaders.listMinecraftVersions();
  log('Son sürüm:', latest);

  const inst = await instances.createInstance(
    {
      source: 'vanilla',
      mcVersion: latest,
      name: 'vanilla-test',
      memoryMb: 2048,
      eulaAccepted: true
    },
    (msg) => log('  ', msg)
  );
  log('Kuruldu:', JSON.stringify({ mc: inst.mcVersion, loader: inst.loader, java: inst.javaPath }));

  const { args } = loaders.resolveLaunch(instances.serverDir(inst.id), 2048);
  log('Launch:', args.join(' '));

  serverproc.setNotifier((ch, d) => ch === 'server:status-change' && log('durum:', d.status));
  await serverproc.start(inst.id);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Açılmadı')), 6 * 60 * 1000);
    const iv = setInterval(() => {
      const buf = serverproc.consoleBuffer(inst.id);
      if (/Done \(/.test(buf)) {
        clearTimeout(timeout); clearInterval(iv); resolve();
      } else if (serverproc.status(inst.id) === 'stopped') {
        clearTimeout(timeout); clearInterval(iv);
        reject(new Error('Erken kapandı:\n' + buf.slice(-2000)));
      }
    }, 1500);
  });
  log('AÇILDI');
  await serverproc.stop(inst.id);
  await instances.deleteInstance(inst.id);
  log('BAŞARILI');
  app.exit(0);
}

app.whenReady().then(() =>
  run().catch((err) => {
    console.error('[VANILLA] HATA:', err.message);
    app.exit(1);
  })
);
