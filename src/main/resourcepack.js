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

function isDatapackPath(filePath) {
  const norm = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  return norm.startsWith('datapacks/') || /(^|\/)datapacks\//.test(norm);
}

function isShaderPackPath(filePath) {
  const norm = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  return norm.startsWith('shaderpacks/') || /(^|\/)shaderpacks\//.test(norm);
}

/**
 * Sadece sunucuyu kesinlikle düşüren / bozuk bağımlılıklı istemci görsel modları.
 * Continuity: Connector üzerinden sunucuda boş version range ile crash.
 * Animasyon/UI kanalı (watut/wakes) KALIR.
 */
function isKnownClientOnlyJar(fileName) {
  const n = String(fileName || '');
  return /(?:^|[^a-z0-9])(?:stop.?rendering|audio.?improvements|subtle.?effects|colorwheel|sodium|iris|rubidium|embeddium|oculus|optifine|xenon|particle.?core|continuity|citresewn|entity.?texture.?features|entity.?model.?features|lambdynamiclights|dynamic.?lights|not.?enough.?animations|skin.?layers.?3d)(?:[^a-z0-9]|$)/i.test(n);
}

/** Sunucu resource-pack URL'sine asla konmaması gereken paket adları (harita ikonu vb.). */
const SKIP_SERVER_RP_NAME_RE =
  /xaero|minimap|journeymap|voxelmap|waypoint|antique.?atlas|icon\s*xaero/i;

function shouldInstallMrpackFile(file) {
  const p = String(file.path || '').replace(/\\/g, '/');
  const low = p.toLowerCase();
  if (isResourcePackPath(p) || isDatapackPath(p)) return true;
  if (isShaderPackPath(p)) return false;
  if (file.env && file.env.server === 'unsupported') {
    if (low.startsWith('mods/')) {
      const base = path.basename(low);
      // Yalnızca hard-crash render; animasyon/UI kanalı olanlar (watut/wakes) kalsın
      return !isKnownClientOnlyJar(base);
    }
    return true;
  }
  return true;
}

/**
 * JAR meta — yalnızca saf Fabric/Quilt (Forge toml yok) ve environment=client.
 * Forge jar'larında clientSideOnly / fabric.mod.json yanıltıcı (Krypton, Sparse Structures…).
 */
function isClientOnlyByJarMeta(_jarPath) {
  // Kullanıcı: hepsini indir, silme — meta ile silme kapalı
  return false;
}

/**
 * Hard-crash istemci jar'larını silmez — .disabled yapar (yedek kalsın).
 * Continuity vb. sunucuyu açmadan düşürür; istemci pack'te kalır.
 */
async function purgeClientOnlyMods(serverDir) {
  const modsDir = path.join(serverDir, 'mods');
  let names = [];
  try {
    names = await fsp.readdir(modsDir);
  } catch (_e) {
    return [];
  }
  const removed = [];
  for (const name of names) {
    if (!/\.jar$/i.test(name) || !isKnownClientOnlyJar(name)) continue;
    const from = path.join(modsDir, name);
    const to = path.join(modsDir, `${name}.disabled`);
    try {
      if (fs.existsSync(to)) await fsp.unlink(from);
      else await fsp.rename(from, to);
      removed.push(name);
    } catch (_e) { /* kilitliyse atla */ }
  }
  return removed;
}

const CLASS_DATAPACKS = 6945;

/** CurseForge classId → hedef klasör (mods / resourcepacks / shaderpacks / datapacks). */
function folderForCurseClass(classId) {
  if (classId === CLASS_RESOURCE_PACKS) return 'resourcepacks';
  if (classId === CLASS_SHADER_PACKS) return 'shaderpacks';
  if (classId === CLASS_DATAPACKS) return 'datapacks';
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
  return out.sort((a, b) => b.size - a.size);
}

/** Zip içinde assets/ var mı? (datapack-only paketler sunucu RP olmamalı) */
function zipHasClientAssets(filePath) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    let hasAssets = false;
    let hasData = false;
    for (const e of zip.getEntries()) {
      const n = String(e.entryName || '').replace(/\\/g, '/').toLowerCase();
      if (n.startsWith('assets/') || n.includes('/assets/')) hasAssets = true;
      if (n.startsWith('data/') || n.includes('/data/')) hasData = true;
      if (hasAssets) return true;
    }
    // sadece data/ → datapack
    if (hasData) return false;
    return false;
  } catch (_e) {
    return true;
  }
}

/**
 * Sunucunun zorladığı resource-pack için aday seç.
 * Xaero ikon / minimap ve saf datapack'leri ele; kalan en büyüğü al.
 */
async function pickServerResourcePack(serverDir) {
  const packs = await listResourcePackFiles(serverDir);
  const eligible = [];
  for (const p of packs) {
    if (SKIP_SERVER_RP_NAME_RE.test(p.name)) continue;
    if (!zipHasClientAssets(p.full)) continue;
    eligible.push(p);
  }
  return { packs, eligible, pack: eligible[0] || null };
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

  const { packs, eligible, pack } = await pickServerResourcePack(serverDir);
  if (!packs.length) {
    log('Resource pack bulunamadı (atlanıyor).\n');
    return null;
  }
  if (!pack) {
    await writeServerProperties(serverDir, {
      'resource-pack': '',
      'resource-pack-sha1': '',
      'require-resource-pack': 'false'
    });
    log(
      `Resource pack atlandı: ${packs.length} zip var ama uygun istemci paketi yok ` +
      `(datapack / Xaero ikon vb. elendi). İstemci kendi launcher paketini kullanmalı.\n`
    );
    return null;
  }

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
    log(
      `Not: ${packs.length} zip; ${eligible.length} uygun. Sunucu paketi: ${pack.name} ` +
      `(Xaero/datapack atlandı).\n`
    );
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
  CLASS_DATAPACKS,
  isResourcePackPath,
  isShaderPackPath,
  isDatapackPath,
  shouldInstallMrpackFile,
  isKnownClientOnlyJar,
  purgeClientOnlyMods,
  folderForCurseClass,
  listResourcePackFiles,
  prepareServerResourcePack,
  stopPackServer,
  getPackServerInfo
};
