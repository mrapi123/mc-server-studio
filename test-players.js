/* Oyuncu + ağ modülleri testi. Çalıştırma: npx electron test-players.js */
const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

app.setPath('userData', path.join(os.tmpdir(), 'mc-server-studio-e2e'));

const instances = require('./src/main/instances');
const players = require('./src/main/players');
const network = require('./src/main/network');

const log = (...a) => console.log('[P-TEST]', ...a);

async function run() {
  // sahte instance oluştur
  const meta = await instances.saveInstance({
    id: 'ptest', name: 'ptest', memoryMb: 2048, createdAt: new Date().toISOString(), status: 'ready'
  });
  fs.mkdirSync(instances.serverDir('ptest'), { recursive: true });
  fs.writeFileSync(path.join(instances.serverDir('ptest'), 'server.properties'),
    'online-mode=false\nserver-port=25565\n');

  // whitelist (offline modda deterministik uuid)
  await players.whitelistAdd('ptest', 'MehmetTest');
  await players.whitelistAdd('ptest', 'Arkadas1');
  let info = await players.getPlayersInfo('ptest');
  log('whitelist:', JSON.stringify(info.whitelist));
  if (info.whitelist.length !== 2) throw new Error('whitelist ekleme hatalı');

  await players.whitelistRemove('ptest', 'Arkadas1');
  info = await players.getPlayersInfo('ptest');
  if (info.whitelist.length !== 1) throw new Error('whitelist silme hatalı');
  log('whitelist silme OK');

  await players.whitelistToggle('ptest', true);
  info = await players.getPlayersInfo('ptest');
  if (!info.whitelistEnabled) throw new Error('whitelist toggle hatalı');
  log('whitelist toggle OK');

  // op
  await players.opAdd('ptest', 'MehmetTest');
  info = await players.getPlayersInfo('ptest');
  log('ops:', JSON.stringify(info.ops));
  if (info.ops.length !== 1 || info.ops[0].level !== 4) throw new Error('op ekleme hatalı');
  await players.opRemove('ptest', 'MehmetTest');

  // olay kaydı
  players.appendEvent('ptest', 'MehmetTest', 'join');
  players.appendEvent('ptest', 'MehmetTest', 'leave');
  info = await players.getPlayersInfo('ptest');
  log('events:', JSON.stringify(info.events));
  if (info.events.length !== 2) throw new Error('olay kaydı hatalı');

  // online modda Mojang uuid çözümleme (gerçek hesap: jeb_)
  fs.writeFileSync(path.join(instances.serverDir('ptest'), 'server.properties'),
    'online-mode=true\nserver-port=25565\n');
  const list = await players.whitelistAdd('ptest', 'jeb_');
  const jeb = list.find((e) => e.name === 'jeb_');
  log('jeb_ uuid:', jeb.uuid);
  if (!/^[0-9a-f-]{36}$/.test(jeb.uuid)) throw new Error('mojang uuid hatalı');

  // ağ bilgisi
  const net = await network.netInfo('ptest');
  log('net:', JSON.stringify(net));
  if (!net.port || !Array.isArray(net.local)) throw new Error('net info hatalı');

  await instances.deleteInstance('ptest');
  log('BAŞARILI');
  app.exit(0);
}

app.whenReady().then(() =>
  run().catch((err) => {
    console.error('[P-TEST] HATA:', err.message);
    app.exit(1);
  })
);
