const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { fetchJson, downloadFile } = require('./util');

let manifestCache = null;

/** Mojang'dan release MC sürümlerini listeler (vanilla kurulum için). */
async function listMinecraftVersions() {
  if (!manifestCache) {
    manifestCache = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  }
  const releases = manifestCache.versions.filter((v) => v.type === 'release');
  return {
    latest: manifestCache.latest.release,
    versions: releases.map((v) => v.id)
  };
}

function runJava(javaExe, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(javaExe, args, { cwd, timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Java komutu başarısız: ${err.message}\n${(stderr || '').slice(-2000)}`));
      else resolve(stdout);
    });
  });
}

async function installFabric(serverDir, mcVersion, loaderVersion) {
  const installers = await fetchJson('https://meta.fabricmc.net/v2/versions/installer');
  const installerVer = installers[0].version;
  if (!loaderVersion) {
    const loaders = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    loaderVersion = loaders[0].loader.version;
  }
  const url = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/${installerVer}/server/jar`;
  await downloadFile(url, path.join(serverDir, 'fabric-server.jar'));
  return { loaderVersion };
}

async function installQuilt(serverDir, mcVersion, loaderVersion, javaExe) {
  const metaXml = await (await fetch(
    'https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml'
  )).text();
  const m = /<release>([^<]+)<\/release>/.exec(metaXml);
  if (!m) throw new Error('Quilt installer sürümü bulunamadı.');
  const iv = m[1];
  const installerPath = path.join(serverDir, 'quilt-installer.jar');
  await downloadFile(
    `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${iv}/quilt-installer-${iv}.jar`,
    installerPath
  );
  const args = ['-jar', installerPath, 'install', 'server', mcVersion];
  if (loaderVersion) args.push(loaderVersion);
  args.push('--download-server', `--install-dir=${serverDir}`);
  await runJava(javaExe, args, serverDir);
  await fsp.unlink(installerPath).catch(() => {});
  return { loaderVersion };
}

async function installForge(serverDir, mcVersion, forgeVersion, javaExe) {
  const full = `${mcVersion}-${forgeVersion}`;
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  const installerPath = path.join(serverDir, 'forge-installer.jar');
  await downloadFile(url, installerPath);
  await runJava(javaExe, ['-jar', installerPath, '--installServer', serverDir], serverDir);
  await fsp.unlink(installerPath).catch(() => {});
  await fsp.unlink(installerPath + '.log').catch(() => {});
  return {};
}

async function installNeoForge(serverDir, neoVersion, javaExe) {
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
  const installerPath = path.join(serverDir, 'neoforge-installer.jar');
  await downloadFile(url, installerPath);
  await runJava(javaExe, ['-jar', installerPath, '--installServer', serverDir], serverDir);
  await fsp.unlink(installerPath).catch(() => {});
  await fsp.unlink(installerPath + '.log').catch(() => {});
  return {};
}

/**
 * Loader kurulumunu yapar. loader: vanilla | fabric | quilt | forge | neoforge
 */
async function installLoader(serverDir, { loader, mcVersion, loaderVersion }, javaExe, report) {
  report(`${loader} ${loaderVersion || ''} kuruluyor...`);
  if (loader === 'fabric') return installFabric(serverDir, mcVersion, loaderVersion);
  if (loader === 'quilt') return installQuilt(serverDir, mcVersion, loaderVersion, javaExe);
  if (loader === 'forge') {
    if (!loaderVersion) {
      const promos = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      loaderVersion = promos.promos[`${mcVersion}-recommended`] || promos.promos[`${mcVersion}-latest`];
      if (!loaderVersion) throw new Error(`Forge için ${mcVersion} sürümü bulunamadı.`);
    }
    await installForge(serverDir, mcVersion, loaderVersion, javaExe);
    return { loaderVersion };
  }
  if (loader === 'neoforge') {
    if (!loaderVersion) {
      const meta = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
      const mm = /^\d+\.(\d+(?:\.\d+)?)/.exec(mcVersion); // 1.21.1 -> 21.1
      const prefix = mm ? mm[1] : '';
      const matching = meta.versions.filter((v) => v.startsWith(prefix + '.'));
      loaderVersion = matching[matching.length - 1];
      if (!loaderVersion) throw new Error(`NeoForge için ${mcVersion} sürümü bulunamadı.`);
    }
    await installNeoForge(serverDir, loaderVersion, javaExe);
    return { loaderVersion };
  }
  if (loader === 'vanilla') {
    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find((v) => v.id === mcVersion);
    if (!entry) throw new Error(`Minecraft ${mcVersion} bulunamadı.`);
    const detail = await fetchJson(entry.url);
    await downloadFile(detail.downloads.server.url, path.join(serverDir, 'server.jar'));
    return {};
  }
  throw new Error(`Bilinmeyen loader: ${loader}`);
}

/** Sunucuyu başlatmak için java argümanlarını hesaplar. */
function resolveLaunch(serverDir, memoryMb) {
  const mem = [`-Xms${Math.min(2048, memoryMb)}M`, `-Xmx${memoryMb}M`];

  function findArgFiles(dir, depth = 0) {
    if (depth > 6 || !fs.existsSync(dir)) return [];
    const found = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return []; }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isFile() && /^(win_args|unix_args|args)\.txt$/i.test(ent.name)) found.push(p);
      else if (ent.isDirectory() && ent.name !== 'mods' && ent.name !== 'world') {
        found.push(...findArgFiles(p, depth + 1));
      }
    }
    return found;
  }

  // Forge / NeoForge: libraries altındaki win_args.txt (veya run.bat eşdeğeri)
  const argFiles = findArgFiles(path.join(serverDir, 'libraries'));
  // Prefer win_args on Windows
  const winArg = argFiles.find((f) => /win_args\.txt$/i.test(f)) || argFiles[0];
  if (winArg) {
    const rel = path.relative(serverDir, winArg);
    return { args: [...mem, `@${rel}`, 'nogui'] };
  }

  // run.bat içinden @libraries\...\win_args.txt yakala
  const runBat = path.join(serverDir, 'run.bat');
  if (fs.existsSync(runBat)) {
    try {
      const bat = fs.readFileSync(runBat, 'utf8');
      const m = /@([^\s"']+args\.txt)/i.exec(bat);
      if (m && fs.existsSync(path.join(serverDir, m[1].replace(/\//g, path.sep)))) {
        return { args: [...mem, `@${m[1]}`, 'nogui'] };
      }
    } catch (_e) { /* ignore */ }
  }

  const jarCandidates = [
    'fabric-server.jar',
    'fabric-server-launch.jar',
    'quilt-server-launch.jar',
    'server.jar'
  ];
  for (const jar of jarCandidates) {
    if (fs.existsSync(path.join(serverDir, jar))) {
      return { args: [...mem, '-jar', jar, 'nogui'] };
    }
  }

  const files = fs.existsSync(serverDir) ? fs.readdirSync(serverDir) : [];
  const named = files.find((f) =>
    /^(forge|neoforge|minecraft_server|paper|purpur|spigot|bukkit).*\.jar$/i.test(f) &&
    !/installer/i.test(f)
  );
  if (named) return { args: [...mem, '-jar', named, 'nogui'] };

  const anyJar = files.find((f) => f.endsWith('.jar') && !/installer/i.test(f));
  if (anyJar) return { args: [...mem, '-jar', anyJar, 'nogui'] };

  throw new Error(
    'Başlatılacak sunucu jar dosyası bulunamadı. Kurulum yarım kalmış olabilir ' +
    '(özellikle büyük modpack indirmeleri). Sunucuyu silip tekrar kurmayı dene.'
  );
}

module.exports = { installLoader, resolveLaunch, listMinecraftVersions };
