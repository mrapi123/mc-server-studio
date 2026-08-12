const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { fetchJson, downloadFile } = require('./util');

/** Minecraft sürümüne göre gereken Java ana sürümü (çevrimdışı tahmin). */
function requiredJavaMajor(mcVersion) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(mcVersion || '');
  if (!m) return 21;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3] || 0);
  if (major >= 26) return 25; // yıl bazlı yeni sürümleme
  if (major > 1) return 21;
  if (minor >= 21) return 21;
  if (minor === 20 && patch >= 5) return 21;
  if (minor >= 17) return 17;
  return 8;
}

let mojangManifestCache = null;

/** Mojang sürüm meta verisinden gereken Java sürümünü okur; bulunamazsa tahmine düşer. */
async function requiredJavaMajorOnline(mcVersion) {
  try {
    if (!mojangManifestCache) {
      mojangManifestCache = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    }
    const entry = mojangManifestCache.versions.find((v) => v.id === mcVersion);
    if (entry) {
      const detail = await fetchJson(entry.url);
      if (detail.javaVersion && detail.javaVersion.majorVersion) {
        return detail.javaVersion.majorVersion;
      }
    }
  } catch (_e) { /* çevrimdışı tahmine düş */ }
  return requiredJavaMajor(mcVersion);
}

function probeJava(javaExe) {
  return new Promise((resolve) => {
    execFile(javaExe, ['-version'], { timeout: 8000 }, (err, _stdout, stderr) => {
      if (err) return resolve(null);
      const m = /version "([^"]+)"/.exec(stderr || '');
      if (!m) return resolve(null);
      const ver = m[1];
      let major;
      if (ver.startsWith('1.')) major = Number(ver.split('.')[1]);
      else major = Number(ver.split('.')[0]);
      resolve({ path: javaExe, version: ver, major });
    });
  });
}

async function listJavaCandidates() {
  const candidates = new Set();

  if (process.env.JAVA_HOME) {
    candidates.add(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  }

  // PATH üzerindeki java
  await new Promise((resolve) => {
    execFile('where', ['java'], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        stdout.split(/\r?\n/).filter(Boolean).forEach((p) => candidates.add(p.trim()));
      }
      resolve();
    });
  });

  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files (x86)\\Java',
    path.join(app.getPath('userData'), 'java')
  ];
  for (const root of roots) {
    try {
      for (const dir of await fsp.readdir(root)) {
        const exe = path.join(root, dir, 'bin', 'java.exe');
        if (fs.existsSync(exe)) candidates.add(exe);
      }
    } catch (_e) { /* klasör yoksa geç */ }
  }
  return [...candidates];
}

async function listJava() {
  const candidates = await listJavaCandidates();
  const results = await Promise.all(candidates.map(probeJava));
  const seen = new Set();
  return results
    .filter(Boolean)
    .filter((j) => {
      const key = `${j.major}|${j.path.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.major - a.major);
}

/** İstenen ana sürüm için kurulu Java bulur, yoksa null döner. */
async function findJavaForMajor(major) {
  const all = await listJava();
  const exact = all.find((j) => j.major === major);
  if (exact) return exact;
  // 17 istenirken 18-20 da çalışır; 8 istenirken sadece 8.
  if (major === 17) return all.find((j) => j.major >= 17 && j.major < 21) || null;
  return null;
}

/** Adoptium'dan Temurin JRE indirir, uygulama verisine açar ve java.exe yolunu döner. */
async function downloadJava(major, onProgress) {
  const assets = await fetchJson(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse`
  );
  if (!assets.length) throw new Error(`Java ${major} için Temurin sürümü bulunamadı.`);
  const pkg = assets[0].binary.package;

  const javaRoot = path.join(app.getPath('userData'), 'java');
  await fsp.mkdir(javaRoot, { recursive: true });
  const zipPath = path.join(javaRoot, pkg.name);
  await downloadFile(pkg.link, zipPath, onProgress);

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(javaRoot, true);
  await fsp.unlink(zipPath).catch(() => {});

  // Zip içindeki üst klasörü bul (örn. jdk-21.0.5+11-jre)
  for (const dir of await fsp.readdir(javaRoot)) {
    const exe = path.join(javaRoot, dir, 'bin', 'java.exe');
    if (fs.existsSync(exe)) {
      const probed = await probeJava(exe);
      if (probed && probed.major === major) return probed;
    }
  }
  throw new Error('Java indirildi ancak java.exe bulunamadı.');
}

/** Gerekli Java'yı bulur; kurulu değilse otomatik indirir. */
async function ensureJava(mcVersion, onProgress) {
  const major = await requiredJavaMajorOnline(mcVersion);
  const found = await findJavaForMajor(major);
  if (found) return found;
  return downloadJava(major, onProgress);
}

module.exports = {
  requiredJavaMajor,
  requiredJavaMajorOnline,
  listJava,
  findJavaForMajor,
  downloadJava,
  ensureJava,
  probeJava
};
