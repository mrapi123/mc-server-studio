const { spawn } = require('child_process');
const loaders = require('./loaders');
const instances = require('./instances');

/** id -> { proc, buffer:[], status } */
const running = new Map();

const MAX_BUFFER_LINES = 2000;

let notify = () => {};
function setNotifier(fn) {
  notify = fn;
}

function status(id) {
  const entry = running.get(id);
  return entry ? entry.status : 'stopped';
}

function onlinePlayers(id) {
  const entry = running.get(id);
  return entry ? [...entry.players] : [];
}

function parsePlayerEvents(id, text) {
  const entry = running.get(id);
  if (!entry) return;
  const players = require('./players');
  let changed = false;
  for (const line of text.split(/\r?\n/)) {
    let m = /\]:\s*([A-Za-z0-9_]{2,16}) joined the game/.exec(line);
    if (m) {
      entry.players.add(m[1]);
      players.appendEvent(id, m[1], 'join');
      changed = true;
      continue;
    }
    m = /\]:\s*([A-Za-z0-9_]{2,16}) left the game/.exec(line);
    if (m) {
      entry.players.delete(m[1]);
      players.appendEvent(id, m[1], 'leave');
      changed = true;
    }
  }
  if (changed) notify('server:players', { id, online: [...entry.players] });
}

function consoleBuffer(id) {
  const entry = running.get(id);
  return entry ? entry.buffer.join('') : '';
}

function pushLog(id, text) {
  const entry = running.get(id);
  if (!entry) return;
  entry.buffer.push(text);
  if (entry.buffer.length > MAX_BUFFER_LINES) entry.buffer.splice(0, entry.buffer.length - MAX_BUFFER_LINES);
  notify('server:log', { id, text });
}

function setStatus(id, s) {
  const entry = running.get(id);
  if (entry) entry.status = s;
  notify('server:status-change', { id, status: s });
}

async function start(id) {
  if (running.has(id) && running.get(id).status !== 'stopped') {
    throw new Error('Sunucu zaten çalışıyor.');
  }
  const meta = await instances.getInstance(id);
  if (meta.status === 'installing') {
    throw new Error('Kurulum henüz bitmedi. Bitmesini bekle veya yarım kaldıysa silip tekrar kur.');
  }
  if (meta.status === 'failed') {
    throw new Error(
      'Kurulum başarısız olmuş: ' + (meta.error || 'bilinmiyor') +
      ' Sunucuyu silip yeniden kurmayı dene.'
    );
  }

  const sDir = instances.serverDir(id);
  let launch;
  try {
    launch = loaders.resolveLaunch(sDir, meta.memoryMb || 4096);
  } catch (err) {
    // Loader bilgisi varsa onarım dene
    if (meta.loader && meta.mcVersion) {
      try {
        const java = meta.javaPath || 'java';
        await loaders.installLoader(
          sDir,
          { loader: meta.loader, mcVersion: meta.mcVersion, loaderVersion: meta.loaderVersion },
          java,
          () => {}
        );
        launch = loaders.resolveLaunch(sDir, meta.memoryMb || 4096);
      } catch (_e2) {
        throw new Error(err.message);
      }
    } else {
      throw err;
    }
  }

  const { args } = launch;
  const javaExe = meta.javaPath || 'java';

  const proc = spawn(javaExe, args, { cwd: sDir, windowsHide: true });
  running.set(id, { proc, buffer: [], status: 'starting', players: new Set() });
  notify('server:status-change', { id, status: 'starting' });
  pushLog(id, `> ${javaExe} ${args.join(' ')}\n`);

  proc.stdout.on('data', (d) => {
    const text = d.toString();
    pushLog(id, text);
    parsePlayerEvents(id, text);
    const entry = running.get(id);
    if (entry && entry.status === 'starting' && /Done \(/.test(text)) {
      setStatus(id, 'running');
    }
  });
  proc.stderr.on('data', (d) => pushLog(id, d.toString()));

  proc.on('exit', (code) => {
    pushLog(id, `\n[Sunucu kapandı, çıkış kodu: ${code}]\n`);
    const entry = running.get(id);
    if (entry) entry.players.clear();
    notify('server:players', { id, online: [] });
    setStatus(id, 'stopped');
  });
  proc.on('error', (err) => {
    pushLog(id, `\n[Hata: ${err.message}]\n`);
    setStatus(id, 'stopped');
  });

  return { status: 'starting' };
}

function sendCommand(id, command) {
  const entry = running.get(id);
  if (!entry || entry.status === 'stopped') throw new Error('Sunucu çalışmıyor.');
  entry.proc.stdin.write(command + '\n');
  pushLog(id, `> ${command}\n`);
}

async function stop(id) {
  const entry = running.get(id);
  if (!entry || entry.status === 'stopped') return;
  setStatus(id, 'stopping');
  try {
    entry.proc.stdin.write('stop\n');
  } catch (_e) { /* stdin kapanmış olabilir */ }

  // 30 sn içinde kapanmazsa öldür
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { entry.proc.kill('SIGKILL'); } catch (_e) { /* zaten ölü */ }
      resolve();
    }, 30000);
    entry.proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function kill(id) {
  const entry = running.get(id);
  if (entry) {
    try { entry.proc.kill('SIGKILL'); } catch (_e) { /* zaten ölü */ }
  }
}

async function stopAll() {
  await Promise.all([...running.keys()].map((id) => stop(id)));
}

function killAll() {
  for (const id of running.keys()) kill(id);
}

module.exports = {
  setNotifier,
  status,
  onlinePlayers,
  consoleBuffer,
  start,
  sendCommand,
  stop,
  kill,
  stopAll,
  killAll
};
