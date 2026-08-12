/* server.properties chunk/görüş ayarları testi. Çalıştırma: npx electron tests/test-props.js */
const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

app.setPath('userData', path.join(os.tmpdir(), 'mc-server-studio-e2e'));

const instances = require('../src/main/instances');
const mods = require('../src/main/mods');

const log = (...a) => console.log('[PROPS]', ...a);

async function run() {
  await instances.saveInstance({
    id: 'props-test',
    name: 'props-test',
    memoryMb: 2048,
    createdAt: new Date().toISOString(),
    status: 'ready'
  });
  const sDir = instances.serverDir('props-test');
  fs.mkdirSync(sDir, { recursive: true });
  fs.writeFileSync(
    path.join(sDir, 'server.properties'),
    [
      'view-distance=10',
      'simulation-distance=10',
      'server-port=25565',
      'motd=A Minecraft Server',
      'max-players=20',
      'online-mode=true',
      'pvp=true',
      'difficulty=easy',
      'gamemode=survival',
      'spawn-protection=16',
      'level-seed=',
      'level-type=minecraft\\:normal',
      'generate-structures=true',
      'hardcore=false',
      'spawn-animals=true',
      'spawn-monsters=true',
      'spawn-npcs=true',
      'allow-nether=true',
      'allow-flight=false',
      'enable-command-block=false',
      'force-gamemode=false',
      'player-idle-timeout=0'
    ].join('\n') + '\n'
  );

  // 1) Okuma
  let props = await mods.getProperties('props-test');
  log('başlangıç view/sim:', props['view-distance'], props['simulation-distance']);
  if (props['view-distance'] !== '10') throw new Error('view-distance okuma hatalı');

  // 2) Chunk / görüş yükselt
  await mods.setProperties('props-test', {
    'view-distance': '16',
    'simulation-distance': '12'
  });
  props = await mods.getProperties('props-test');
  log('yükseltme sonrası:', props['view-distance'], props['simulation-distance']);
  if (props['view-distance'] !== '16' || props['simulation-distance'] !== '12') {
    throw new Error('chunk yükseltme yazılamadı');
  }

  // 3) Düşür
  await mods.setProperties('props-test', {
    'view-distance': '8',
    'simulation-distance': '6'
  });
  props = await mods.getProperties('props-test');
  log('düşürme sonrası:', props['view-distance'], props['simulation-distance']);
  if (props['view-distance'] !== '8' || props['simulation-distance'] !== '6') {
    throw new Error('chunk düşürme yazılamadı');
  }

  // 4) Ultra preset
  await mods.setProperties('props-test', {
    'view-distance': '32',
    'simulation-distance': '16'
  });
  props = await mods.getProperties('props-test');
  if (props['view-distance'] !== '32' || props['simulation-distance'] !== '16') {
    throw new Error('ultra preset yazılamadı');
  }
  log('ultra OK');

  // 5) Diğer sunucu ayarları bozulmadan kalmalı
  if (props['server-port'] !== '25565' || props.motd !== 'A Minecraft Server') {
    throw new Error('diğer ayarlar bozuldu');
  }

  // 6) Dünya ayarları
  await mods.setProperties('props-test', {
    'level-seed': '12345',
    'level-type': 'minecraft:flat',
    hardcore: 'true',
    'allow-flight': 'true',
    'enable-command-block': 'true'
  });
  props = await mods.getProperties('props-test');
  log('dünya:', props['level-seed'], props['level-type'], props.hardcore, props['allow-flight']);
  if (props['level-seed'] !== '12345') throw new Error('seed yazılamadı');
  if (props['level-type'] !== 'minecraft:flat') throw new Error('level-type yazılamadı');
  if (props.hardcore !== 'true') throw new Error('hardcore yazılamadı');

  // 7) Dünya sıfırlama
  const worldPath = path.join(sDir, 'world');
  fs.mkdirSync(path.join(worldPath, 'region'), { recursive: true });
  fs.writeFileSync(path.join(worldPath, 'level.dat'), 'fake');
  fs.mkdirSync(path.join(sDir, 'world_nether'), { recursive: true });
  await instances.resetWorld('props-test');
  if (fs.existsSync(worldPath) || fs.existsSync(path.join(sDir, 'world_nether'))) {
    throw new Error('dünya sıfırlama çalışmadı');
  }
  log('dünya sıfırlama OK');

  await instances.deleteInstance('props-test');
  log('BAŞARILI');
  app.exit(0);
}

app.whenReady().then(() =>
  run().catch((err) => {
    console.error('[PROPS] HATA:', err.message);
    app.exit(1);
  })
);
