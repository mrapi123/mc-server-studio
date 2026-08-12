const { app } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { downloadFile, runLimited, copyDirInto, sanitizeName } = require('./util');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const loaders = require('./loaders');
const javaMgr = require('./java');
const settings = require('./settings');

function instancesRoot() {
  return path.join(app.getPath('userData'), 'instances');
}

function instanceDir(id) {
  return path.join(instancesRoot(), id);
}

function serverDir(id) {
  return path.join(instanceDir(id), 'server');
}

async function listInstances() {
  const root = instancesRoot();
  let dirs = [];
  try {
    dirs = await fsp.readdir(root);
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const d of dirs) {
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(root, d, 'instance.json'), 'utf8'));
      out.push(meta);
    } catch (_e) { /* bozuk klasörü atla */ }
  }
  return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getInstance(id) {
  return JSON.parse(await fsp.readFile(path.join(instanceDir(id), 'instance.json'), 'utf8'));
}

async function saveInstance(meta) {
  await fsp.mkdir(instanceDir(meta.id), { recursive: true });
  await fsp.writeFile(path.join(instanceDir(meta.id), 'instance.json'), JSON.stringify(meta, null, 2));
  return meta;
}

async function deleteInstance(id) {
  await fsp.rm(instanceDir(id), { recursive: true, force: true });
}

function newId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'sunucu';
  return `${slug}-${Date.now().toString(36)}`;
}

/** Zip'i hedef klasöre açar; zip tek bir üst klasörden oluşuyorsa o katmanı atlar. */
function extractZipSmart(zipPath, destDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const roots = new Set(entries.map((e) => e.entryName.split('/')[0]));
  const singleRoot = roots.size === 1 && entries.every((e) => e.entryName.includes('/'))
    ? [...roots][0]
    : null;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let rel = entry.entryName;
    if (singleRoot) rel = rel.slice(singleRoot.length + 1);
    if (!rel) continue;
    const target = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
}

/* ---------------- Modrinth (.mrpack) kurulumu ---------------- */

async function installMrpack(mrpackPath, destDir, report) {
  const zip = new AdmZip(mrpackPath);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('Geçersiz mrpack: modrinth.index.json bulunamadı.');
  const index = JSON.parse(indexEntry.getData().toString('utf8'));

  const files = (index.files || []).filter((f) => !(f.env && f.env.server === 'unsupported'));
  report(`${files.length} dosya indirilecek...`);
  let done = 0;
  await runLimited(files, 6, async (f) => {
    const target = path.join(destDir, f.path);
    if (target.includes('..')) throw new Error(`Güvensiz dosya yolu: ${f.path}`);
    await downloadFile(f.downloads[0], target);
    done++;
    report(`Mod dosyaları indiriliyor (${done}/${files.length})`, done, files.length);
  });

  // overrides ve server-overrides klasörlerini kopyala
  const tmpOverrides = destDir + '_overrides_tmp';
  await fsp.rm(tmpOverrides, { recursive: true, force: true });
  zip.extractAllTo(tmpOverrides, true);
  await copyDirInto(path.join(tmpOverrides, 'overrides'), destDir);
  await copyDirInto(path.join(tmpOverrides, 'server-overrides'), destDir);
  await fsp.rm(tmpOverrides, { recursive: true, force: true });

  const deps = index.dependencies || {};
  let loader = 'vanilla';
  let loaderVersion = null;
  if (deps['fabric-loader']) { loader = 'fabric'; loaderVersion = deps['fabric-loader']; }
  else if (deps['quilt-loader']) { loader = 'quilt'; loaderVersion = deps['quilt-loader']; }
  else if (deps.neoforge) { loader = 'neoforge'; loaderVersion = deps.neoforge; }
  else if (deps.forge) { loader = 'forge'; loaderVersion = deps.forge; }

  return {
    mcVersion: deps.minecraft,
    loader,
    loaderVersion,
    packName: index.name,
    packVersion: index.versionId,
    failedMods: []
  };
}

/* ---------------- CurseForge kurulumu ---------------- */

async function installCurseForgeManifest(zipPath, destDir, report) {
  const zip = new AdmZip(zipPath);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Geçersiz CurseForge paketi: manifest.json bulunamadı.');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));

  const mcVersion = manifest.minecraft.version;
  const primaryLoader = (manifest.minecraft.modLoaders || []).find((l) => l.primary) ||
    (manifest.minecraft.modLoaders || [])[0];
  let loader = 'vanilla';
  let loaderVersion = null;
  if (primaryLoader && primaryLoader.id) {
    const [lname, ...rest] = primaryLoader.id.split('-');
    loader = lname.toLowerCase();
    loaderVersion = rest.join('-');
  }

  const files = manifest.files || [];
  report(`${files.length} mod indirilecek...`);
  const failedMods = [];
  let done = 0;

  await runLimited(files, 4, async (f) => {
    try {
      const fileInfo = await curseforge.getFile(f.projectID, f.fileID);
      const url = fileInfo.downloadUrl || (await curseforge.resolveDownloadUrl(f.projectID, f.fileID, fileInfo.fileName));
      await downloadFile(url, path.join(destDir, 'mods', fileInfo.fileName));
    } catch (_e) {
      let name = `proje ${f.projectID}`;
      try {
        const mod = await curseforge.getMod(f.projectID);
        name = mod.name;
      } catch (_e2) { /* isim alınamadı */ }
      failedMods.push({ projectID: f.projectID, fileID: f.fileID, name });
    } finally {
      done++;
      report(`Modlar indiriliyor (${done}/${files.length})`, done, files.length);
    }
  });

  // overrides kopyala
  const overridesName = manifest.overrides || 'overrides';
  const tmpOverrides = destDir + '_overrides_tmp';
  await fsp.rm(tmpOverrides, { recursive: true, force: true });
  zip.extractAllTo(tmpOverrides, true);
  await copyDirInto(path.join(tmpOverrides, overridesName), destDir);
  await fsp.rm(tmpOverrides, { recursive: true, force: true });

  return {
    mcVersion,
    loader,
    loaderVersion,
    packName: manifest.name,
    packVersion: manifest.version,
    failedMods
  };
}

/* ---------------- Ortak kurulum akışı ---------------- */

async function finalizeInstall(meta, sDir, report) {
  // Java hazırla
  report('Uygun Java sürümü kontrol ediliyor...');
  const java = await javaMgr.ensureJava(meta.mcVersion, (recv, total) => {
    if (total) report(`Java indiriliyor (%${Math.round((recv / total) * 100)})`, recv, total);
  });
  meta.javaPath = java.path;

  // Loader kur (server pack zaten çalıştırılabilir olabilir)
  let launchReady = false;
  try {
    loaders.resolveLaunch(sDir, meta.memoryMb);
    launchReady = true;
  } catch (_e) { /* loader kurulumu gerekiyor */ }

  if (!launchReady) {
    const result = await loaders.installLoader(
      sDir,
      { loader: meta.loader, mcVersion: meta.mcVersion, loaderVersion: meta.loaderVersion },
      java.path,
      report
    );
    if (result.loaderVersion) meta.loaderVersion = result.loaderVersion;
  }

  // EULA
  if (meta.eulaAccepted) {
    await fsp.writeFile(path.join(sDir, 'eula.txt'), 'eula=true\n');
  }

  meta.status = 'ready';
  await saveInstance(meta);
  report('Kurulum tamamlandı!');
  return meta;
}

/**
 * Modpack'ten yeni sunucu kurar.
 * payload: { source, projectId, versionId|fileId, name, memoryMb, eulaAccepted, packIcon }
 */
async function createInstance(payload, report) {
  const name = sanitizeName(payload.name);
  const id = newId(name);
  const sDir = serverDir(id);
  await fsp.mkdir(sDir, { recursive: true });

  const meta = {
    id,
    name,
    source: payload.source,
    icon: payload.packIcon || null,
    memoryMb: payload.memoryMb || settings.get().defaultMemoryMb,
    eulaAccepted: !!payload.eulaAccepted,
    createdAt: new Date().toISOString(),
    status: 'installing'
  };

  try {
    if (payload.source === 'modrinth') {
      report('Modpack indiriliyor...');
      const versions = await modrinth.getPackVersions(payload.projectId);
      const version = versions.find((v) => v.id === payload.versionId) || versions[0];
      if (!version) throw new Error('Modpack sürümü bulunamadı.');
      const mrpackPath = path.join(instanceDir(id), 'pack.mrpack');
      await downloadFile(version.fileUrl, mrpackPath, (r, t) => {
        if (t) report(`Modpack indiriliyor (%${Math.round((r / t) * 100)})`, r, t);
      });
      Object.assign(meta, await installMrpack(mrpackPath, sDir, report));
      await fsp.unlink(mrpackPath).catch(() => {});
    } else if (payload.source === 'curseforge') {
      const file = await curseforge.getFile(payload.projectId, payload.fileId);

      if (file.serverPackFileId) {
        // Hazır sunucu paketi varsa onu kullan
        report('Sunucu paketi (server pack) indiriliyor...');
        const spFile = await curseforge.getFile(payload.projectId, file.serverPackFileId);
        const url = spFile.downloadUrl ||
          (await curseforge.resolveDownloadUrl(payload.projectId, file.serverPackFileId, spFile.fileName));
        const zipPath = path.join(instanceDir(id), 'serverpack.zip');
        await downloadFile(url, zipPath, (r, t) => {
          if (t) report(`Sunucu paketi indiriliyor (%${Math.round((r / t) * 100)})`, r, t);
        });
        report('Sunucu paketi açılıyor...');
        extractZipSmart(zipPath, sDir);
        await fsp.unlink(zipPath).catch(() => {});

        // mc sürümü / loader bilgisi client dosyasının gameVersions verisinden alınır
        const mapped = { mcVersions: [], loaders: [] };
        for (const gv of file.gameVersions || []) {
          if (/^\d+\.\d+(\.\d+)?$/.test(gv)) mapped.mcVersions.push(gv);
          else mapped.loaders.push(gv.toLowerCase());
        }
        meta.mcVersion = mapped.mcVersions[0] || null;
        meta.loader = ['neoforge', 'forge', 'fabric', 'quilt'].find((l) => mapped.loaders.includes(l)) || 'forge';
        meta.packName = file.displayName;
        meta.packVersion = file.displayName;
        meta.failedMods = [];
      } else {
        report('Modpack indiriliyor...');
        const url = file.downloadUrl ||
          (await curseforge.resolveDownloadUrl(payload.projectId, payload.fileId, file.fileName));
        const zipPath = path.join(instanceDir(id), 'pack.zip');
        await downloadFile(url, zipPath, (r, t) => {
          if (t) report(`Modpack indiriliyor (%${Math.round((r / t) * 100)})`, r, t);
        });
        Object.assign(meta, await installCurseForgeManifest(zipPath, sDir, report));
        await fsp.unlink(zipPath).catch(() => {});
      }
    } else {
      throw new Error(`Bilinmeyen kaynak: ${payload.source}`);
    }

    return await finalizeInstall(meta, sDir, report);
  } catch (err) {
    meta.status = 'failed';
    meta.error = err.message;
    await saveInstance(meta).catch(() => {});
    throw err;
  }
}

/** Diskteki bir .mrpack veya CurseForge zip dosyasından sunucu kurar. */
async function importPackFile(payload, report) {
  const { filePath, name, memoryMb, eulaAccepted } = payload;
  const id = newId(sanitizeName(name || path.basename(filePath)));
  const sDir = serverDir(id);
  await fsp.mkdir(sDir, { recursive: true });

  const meta = {
    id,
    name: sanitizeName(name || path.basename(filePath, path.extname(filePath))),
    source: 'dosya',
    icon: null,
    memoryMb: memoryMb || settings.get().defaultMemoryMb,
    eulaAccepted: !!eulaAccepted,
    createdAt: new Date().toISOString(),
    status: 'installing'
  };

  try {
    const zip = new AdmZip(filePath);
    if (zip.getEntry('modrinth.index.json')) {
      Object.assign(meta, await installMrpack(filePath, sDir, report));
    } else if (zip.getEntry('manifest.json')) {
      Object.assign(meta, await installCurseForgeManifest(filePath, sDir, report));
    } else {
      throw new Error('Dosya tanınmadı: mrpack veya CurseForge modpack zip dosyası seçin.');
    }
    return await finalizeInstall(meta, sDir, report);
  } catch (err) {
    meta.status = 'failed';
    meta.error = err.message;
    await saveInstance(meta).catch(() => {});
    throw err;
  }
}

module.exports = {
  instancesRoot,
  instanceDir,
  serverDir,
  listInstances,
  getInstance,
  saveInstance,
  deleteInstance,
  createInstance,
  importPackFile
};
