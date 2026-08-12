const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

const CLASS_RESOURCE_PACKS = 12;
const CLASS_SHADER_PACKS = 6552;

/** id -> { server, port, fileName } */
const servers = new Map();

function resourcePacksDir(serverDir) {
  return path.join(serverDir, 'resourcepacks');
}

function isResourcePackPath(filePath) {
  const norm = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  return norm.startsWith('resourcepacks/') || /(^|\/)resourcepacks\//.test(norm);
}

function isShaderPackPath(filePath) {
  const norm = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  return norm.startsWith('shaderpacks/') || /(^|\/)shaderpacks\//.test(norm);
}

/**
 * Saf istemci / render modları — sunucuya konursa bağımlılık zinciri kırılır
 * (örn. colorwheel → oculus ister; oculus zaten atlanır → sunucu çöker).
 */
const CLIENT_ONLY_RE =
  /sodium|iris|rubidium|embeddium|oculus|optifine|xenon|colorwheel|entityculling|fancymenu|dynamic.?fps|skinlayers|sound.?physics|lambdynamic|citresewn|continuity|blur-|zoomify|screenshot|modernfix|f3(name)?|drippy|presencefootsteps|notenoughcrashes|betterf3|crash.?assistant|immediatelyfast|freecam|firstperson|mouse.?tweaks|itemzoom|controlling|catalogue|toastcontrol|light.?overlay|dynamiclights|sodiumoptions|entity.?model.?features|entity.?texture.?features|oculus|iris|reeses.?sodium|rubidium/i;

function shouldInstallMrpackFile(file) {
  const p = String(file.path || '').replace(/\\/g, '/');
  const low = p.toLowerCase();
  if (isResourcePackPath(p)) return true;
  if (isShaderPackPath(p)) return false;
  if (file.env && file.env.server === 'unsupported') {
    if (low.startsWith('mods/')) {
      const base = path.basename(low);
      // Bilinen saf istemci modlarını atla; diğerlerini (animasyon vb.) sunucuya koy
      return !CLIENT_ONLY_RE.test(base);
    }
    return true;
  }
  return true;
}

function isKnownClientOnlyJar(fileName) {
  return CLIENT_ONLY_RE.test(String(fileName || ''));
}

/** mods klasöründen bilinen istemci-only jar'ları siler (kısmi kurulum / eski sync temizliği). */
async function purgeClientOnlyMods(serverDir) {
  const modsDir = path.join(serverDir, 'mods');
  let removed = [];
  let names;
  try {
    names = await fsp.readdir(modsDir);
  } catch (_e) {
    return removed;
  }
  for (const name of names) {
    if (!/\.jar$/i.test(name)) continue;
    if (!isKnownClientOnlyJar(name)) continue;
    try {
      await fsp.unlink(path.join(modsDir, name));
      removed.push(name);
    } catch (_e) { /* kilitli olabilir */ }
  }
  return removed;
}

/** CurseForge classId → hedef klasör (mods / resourcepacks / shaderpacks). */
function folderForCurseClass(classId) {
  if (classId === CLASS_RESOURCE_PACKS) return 'resourcepacks';
  if (classId === CLASS_SHADER_PACKS) return 'shaderpacks';
  return 'mods';
}

async function listResourcePackFiles(serverDir) {
  const dir = resourcePacksDir(serverDir);
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!/\.(zip|tar\.gz)$/i.test(name)) continue;
    const full = path.join(dir, name);
    const st = await fsp.stat(full);
    if (st.isFile()) out.push({ name, full, size: st.size });
  }
  // En büyük paket genelde ana resource pack
  return out.sort((a, b) => b.size - a.size);
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function primaryLanIp() {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

function stopPackServer(instanceId) {
  const entry = servers.get(instanceId);
  if (!entry) return;
  try { entry.server.close(); } catch (_e) { /* ignore */ }
  servers.delete(instanceId);
}

/**
 * Resource pack varsa yerel HTTP ile yayınlar ve server.properties'e yazar.
 * Minecraft istemcileri bağlanırken bu URL'den paketi indirir.
 */
async function prepareServerResourcePack(instanceId, serverDir, log = () => {}) {
  stopPackServer(instanceId);

  const packs = await listResourcePackFiles(serverDir);
  if (!packs.length) {
    log('Resource pack bulunamadı (atlanıyor).\n');
    return null;
  }

  const pack = packs[0];
  const sha1 = await sha1File(pack.full);
  const port = 25566 + (Math.abs(hashCode(instanceId)) % 100);

  const fileBuf = await fsp.readFile(pack.full);
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === `/${encodeURIComponent(pack.name)}` || req.url === '/pack.zip') {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': fileBuf.length,
        'Content-Disposition': `attachment; filename="${pack.name}"`
      });
      res.end(fileBuf);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });

  const ip = primaryLanIp();
  const url = `http://${ip}:${port}/pack.zip`;
  servers.set(instanceId, { server, port, fileName: pack.name, url, sha1 });

  await writeServerProperties(serverDir, {
    'resource-pack': url,
    'resource-pack-sha1': sha1,
    'require-resource-pack': 'false'
  });

  log(`Resource pack yayında: ${pack.name} → ${url}\n`);
  if (packs.length > 1) {
    log(`Not: ${packs.length} resource pack var; sunucu paketi olarak en büyüğü seçildi (${pack.name}).\n`);
  }
  return { url, sha1, fileName: pack.name, port, count: packs.length };
}

async function writeServerProperties(serverDir, updates) {
  const file = path.join(serverDir, 'server.properties');
  let lines = [];
  if (fs.existsSync(file)) {
    lines = (await fsp.readFile(file, 'utf8')).split(/\r?\n/);
  }
  const remaining = { ...updates };
  lines = lines.map((line) => {
    if (!line || line.startsWith('#')) return line;
    const idx = line.indexOf('=');
    if (idx <= 0) return line;
    const key = line.slice(0, idx);
    if (key in remaining) {
      const val = remaining[key];
      delete remaining[key];
      return `${key}=${val}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(remaining)) lines.push(`${k}=${v}`);
  await fsp.writeFile(file, lines.join('\n'));
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h;
}

function getPackServerInfo(instanceId) {
  const e = servers.get(instanceId);
  if (!e) return null;
  return { port: e.port, fileName: e.fileName, url: e.url, sha1: e.sha1 };
}

module.exports = {
  CLASS_RESOURCE_PACKS,
  CLASS_SHADER_PACKS,
  isResourcePackPath,
  isShaderPackPath,
  shouldInstallMrpackFile,
  isKnownClientOnlyJar,
  purgeClientOnlyMods,
  folderForCurseClass,
  listResourcePackFiles,
  prepareServerResourcePack,
  stopPackServer,
  getPackServerInfo
};
