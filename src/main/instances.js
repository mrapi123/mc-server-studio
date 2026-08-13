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
const resourcepack = require('./resourcepack');

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
    const dir = path.join(root, d);
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(dir, 'instance.json'), 'utf8'));
      out.push(meta);
    } catch (_e) {
      // Yarım kalmış klasör (meta yok) — çöp temizliği
      try {
        await fsp.rm(dir, { recursive: true, force: true });
      } catch (_e2) { /* ignore */ }
    }
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
  const roots = new Set(
    entries
      .map((e) => e.entryName.replace(/\\/g, '/').split('/')[0])
      .filter(Boolean)
  );
  const normalized = entries.map((e) => ({
    entry: e,
    name: e.entryName.replace(/\\/g, '/')
  }));
  const singleRoot = roots.size === 1 && normalized.every((e) => e.name.includes('/'))
    ? [...roots][0]
    : null;

  const destResolved = path.resolve(destDir);
  for (const { entry, name } of normalized) {
    if (entry.isDirectory) continue;
    let rel = name;
    if (singleRoot) rel = rel.slice(singleRoot.length + 1);
    if (!rel) continue;
    const target = path.resolve(destDir, rel);
    if (target !== destResolved && !target.startsWith(destResolved + path.sep)) {
      continue; // zip slip — atla
    }
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

  // Resource pack'ler client-only işaretli olsa bile sunucuya indirilir (istemcilere sunulacak)
  const files = (index.files || []).filter((f) => resourcepack.shouldInstallMrpackFile(f));
  const skipped = (index.files || []).length - files.length;
  report(`${files.length} dosya indirilecek${skipped ? ` (${skipped} client-only mod atlandı)` : ''}...`);
  let done = 0;
  const destResolved = path.resolve(destDir);
  await runLimited(files, 6, async (f) => {
    const target = path.resolve(destDir, f.path);
    if (target !== destResolved && !target.startsWith(destResolved + path.sep)) {
      throw new Error(`Güvensiz dosya yolu: ${f.path}`);
    }
    await downloadFile(f.downloads[0], target);
    done++;
    const label = resourcepack.isResourcePackPath(f.path) ? 'Resource pack' : 'Dosya';
    report(`${label} indiriliyor (${done}/${files.length})`, done, files.length);
  });

  // overrides ve server-overrides klasörlerini kopyala
  const tmpOverrides = destDir + '_overrides_tmp';
  await fsp.rm(tmpOverrides, { recursive: true, force: true });
  zip.extractAllTo(tmpOverrides, true);
  await copyDirInto(path.join(tmpOverrides, 'overrides'), destDir);
  await copyDirInto(path.join(tmpOverrides, 'server-overrides'), destDir);
  await fsp.rm(tmpOverrides, { recursive: true, force: true });

  try {
    const rps = await resourcepack.listResourcePackFiles(destDir);
    if (rps.length) report(`${rps.length} resource pack kuruldu (sunucu açılınca oyunculara gönderilir).`);
  } catch (_e) { /* ignore */ }

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
  report(`${files.length} dosya indirilecek (mod + resource pack)...`);
  const failedMods = [];
  let done = 0;
  let rpCount = 0;

  await runLimited(files, 4, async (f) => {
    try {
      const fileInfo = await curseforge.getFile(f.projectID, f.fileID);
      if (resourcepack.isKnownClientOnlyJar(fileInfo.fileName)) return;
      let classId = 6;
      try {
        const mod = await curseforge.getMod(f.projectID);
        classId = mod.classId || 6;
      } catch (_e) { /* varsayılan mods */ }

      // Dosya adına göre de tahmin (API class vermezse)
      let folder = resourcepack.folderForCurseClass(classId);
      if (folder === 'mods' && /\.zip$/i.test(fileInfo.fileName) && !/\.jar$/i.test(fileInfo.fileName)) {
        // Zip + mods class değilse resource pack olabilir — classId kontrolü yeterli
      }
      if (folder === 'resourcepacks') rpCount++;

      const url = fileInfo.downloadUrl || (await curseforge.resolveDownloadUrl(f.projectID, f.fileID, fileInfo.fileName));
      await fsp.mkdir(path.join(destDir, folder), { recursive: true });
      await downloadFile(url, path.join(destDir, folder, fileInfo.fileName));
    } catch (_e) {
      let name = `proje ${f.projectID}`;
      try {
        const mod = await curseforge.getMod(f.projectID);
        name = mod.name;
      } catch (_e2) { /* isim alınamadı */ }
      failedMods.push({ projectID: f.projectID, fileID: f.fileID, name });
    } finally {
      done++;
      report(`Dosyalar indiriliyor (${done}/${files.length})`, done, files.length);
    }
  });

  if (rpCount) report(`${rpCount} resource pack indirildi.`);

  // overrides kopyala
  const overridesName = manifest.overrides || 'overrides';
  const tmpOverrides = destDir + '_overrides_tmp';
  await fsp.rm(tmpOverrides, { recursive: true, force: true });
  zip.extractAllTo(tmpOverrides, true);
  await copyDirInto(path.join(tmpOverrides, overridesName), destDir);
  await fsp.rm(tmpOverrides, { recursive: true, force: true });

  // Overrides içindeki resourcepacks say
  try {
    const rps = await resourcepack.listResourcePackFiles(destDir);
    if (rps.length) report(`Toplam ${rps.length} resource pack hazır.`);
  } catch (_e) { /* ignore */ }

  return {
    mcVersion,
    loader,
    loaderVersion,
    packName: manifest.name,
    packVersion: manifest.version,
    failedMods
  };
}

/**
 * Server pack'te eksik kalan istemci modlarını (animasyon vb.) client pack manifestinden tamamlar.
 * Saf istemci render modları (Sodium/Iris...) atlanır.
 * CurseForge: API anahtarı varsa batch; yoksa paralel tekil istek (sıralı 40/469 takılması yok).
 */
async function syncMissingFromClientPack(clientZipPath, destDir, report) {
  const zip = new AdmZip(clientZipPath);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    report('İstemci paketinde manifest yok, senkron atlandı.');
    return { added: 0, failedMods: [] };
  }
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  const files = manifest.files || [];

  const existing = new Set();
  for (const folder of ['mods', 'resourcepacks', 'shaderpacks']) {
    try {
      for (const n of await fsp.readdir(path.join(destDir, folder))) {
        existing.add(n.toLowerCase());
      }
    } catch (_e) { /* klasör yok */ }
  }

  const failedMods = [];
  report(`İstemci listesi: ${files.length} dosya bilgisi alınıyor...`);
  const filesById = await curseforge.getFilesForManifest(files, (done, total) => {
    report(`İstemci listesi kontrol: ${done}/${total}`, done, total);
  });

  const candidates = [];
  for (const f of files) {
    const fileInfo = filesById.get(f.fileID) || filesById.get(Number(f.fileID));
    if (!fileInfo || !fileInfo.fileName) {
      failedMods.push({ projectID: f.projectID, fileID: f.fileID, name: `file ${f.fileID}` });
      continue;
    }
    if (existing.has(fileInfo.fileName.toLowerCase())) continue;
    if (resourcepack.isKnownClientOnlyJar(fileInfo.fileName)) continue;
    candidates.push({ f, fileInfo });
  }

  report(`${candidates.length} aday dosya için proje bilgisi alınıyor...`);
  const modIds = candidates.map((c) => c.f.projectID);
  const modsById = await curseforge.getModsByIds(modIds, (done, total) => {
    report(`Proje bilgisi: ${done}/${total}`, done, total);
  });

  const missing = [];
  for (const item of candidates) {
    const mod = modsById.get(item.f.projectID) || modsById.get(Number(item.f.projectID));
    const classId = (mod && mod.classId) || 6;
    if (classId === resourcepack.CLASS_SHADER_PACKS) continue;
    const folder = resourcepack.folderForCurseClass(classId);
    missing.push({ ...item, folder });
  }

  report(`Server pack'te eksik ${missing.length} dosya (toplam istemci: ${files.length}). İndiriliyor...`);
  let done = 0;
  let added = 0;
  await runLimited(missing, 6, async (item) => {
    try {
      const url = item.fileInfo.downloadUrl ||
        (await curseforge.resolveDownloadUrl(item.f.projectID, item.f.fileID, item.fileInfo.fileName));
      await fsp.mkdir(path.join(destDir, item.folder), { recursive: true });
      await downloadFile(url, path.join(destDir, item.folder, item.fileInfo.fileName));
      added++;
    } catch (_e) {
      let name = item.fileInfo.fileName;
      const mod = modsById.get(item.f.projectID) || modsById.get(Number(item.f.projectID));
      if (mod && mod.name) name = mod.name;
      failedMods.push({ projectID: item.f.projectID, fileID: item.f.fileID, name });
    } finally {
      done++;
      report(`Eksik dosyalar (${done}/${missing.length})`, done, missing.length);
    }
  });

  // Client overrides (resourcepacks vb.) birleştir
  const overridesName = manifest.overrides || 'overrides';
  const tmp = destDir + '_client_overrides_tmp';
  await fsp.rm(tmp, { recursive: true, force: true });
  zip.extractAllTo(tmp, true);
  await copyDirInto(path.join(tmp, overridesName), destDir);
  await fsp.rm(tmp, { recursive: true, force: true });

  const purged = await resourcepack.purgeClientOnlyMods(destDir);
  if (purged.length) {
    report(`${purged.length} istemci-only mod sunucudan çıkarıldı.`);
  }

  report(`${added} eksik mod/resource pack eklendi.`);
  return { added, failedMods, clientTotal: files.length };
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
    if (!meta.loader || !meta.mcVersion) {
      throw new Error(
        'Sunucu paketi eksik veya bozuk (jar bulunamadı). ' +
        'Büyük indirmeler kesilmiş olabilir — sunucuyu silip tekrar kur.'
      );
    }
    const result = await loaders.installLoader(
      sDir,
      { loader: meta.loader, mcVersion: meta.mcVersion, loaderVersion: meta.loaderVersion },
      java.path,
      report
    );
    if (result.loaderVersion) meta.loaderVersion = result.loaderVersion;
  }

  // Kurulum gerçekten başlatılabilir mi?
  try {
    loaders.resolveLaunch(sDir, meta.memoryMb);
  } catch (err) {
    throw new Error(
      'Kurulum tamamlanamadı: ' + err.message
    );
  }

  // Overrides hard-crash jar geri koymuş olabilir — son temizlik
  const purged = await resourcepack.purgeClientOnlyMods(sDir);
  if (purged.length) {
    report(`${purged.length} hard-crash istemci modu çıkarıldı.`);
  }

  // EULA
  if (meta.eulaAccepted) {
    await fsp.writeFile(path.join(sDir, 'eula.txt'), 'eula=true\n');
  }

  meta.status = 'ready';
  meta.error = null;
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
  await saveInstance(meta);

  try {
    if (payload.source === 'vanilla') {
      const mcVersion = payload.mcVersion;
      if (!mcVersion) throw new Error('Minecraft sürümü seçilmedi.');
      report(`Vanilla sunucu kuruluyor (MC ${mcVersion})...`);
      meta.mcVersion = mcVersion;
      meta.loader = 'vanilla';
      meta.loaderVersion = null;
      meta.packName = `Vanilla ${mcVersion}`;
      meta.packVersion = mcVersion;
      meta.failedMods = [];
      // Loader kurulumu finalizeInstall içinde yapılır
    } else if (payload.source === 'modrinth') {
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
        try {
          const rps = await resourcepack.listResourcePackFiles(sDir);
          if (rps.length) report(`${rps.length} resource pack paketten geldi.`);
        } catch (_e) { /* ignore */ }

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

        // Server pack eksik mod bırakır (örn. 353 vs 469). İstemci listesinden tamamla.
        report('İstemci paketinden eksik modlar senkronize ediliyor...');
        const clientUrl = file.downloadUrl ||
          (await curseforge.resolveDownloadUrl(payload.projectId, payload.fileId, file.fileName));
        const clientZip = path.join(instanceDir(id), 'clientpack.zip');
        await downloadFile(clientUrl, clientZip, (r, t) => {
          if (t) report(`İstemci paketi indiriliyor (%${Math.round((r / t) * 100)})`, r, t);
        });
        const sync = await syncMissingFromClientPack(clientZip, sDir, report);
        meta.failedMods = sync.failedMods || [];
        meta.clientModCount = sync.clientTotal;
        await fsp.unlink(clientZip).catch(() => {});
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
    const msg = err && err.message ? err.message : String(err);
    meta.error = msg;
    await saveInstance(meta).catch(() => {});
    throw new Error(msg);
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

/** Dünya klasörlerini siler (yeni seed/dünya tipi için). Sunucu kapalıyken çağrılmalı. */
async function resetWorld(id) {
  const sDir = serverDir(id);
  let levelName = 'world';
  try {
    const raw = await fsp.readFile(path.join(sDir, 'server.properties'), 'utf8');
    const m = /^level-name=(.*)$/m.exec(raw);
    if (m && m[1].trim()) levelName = m[1].trim();
  } catch (_e) { /* varsayılan kullan */ }

  const targets = [levelName, `${levelName}_nether`, `${levelName}_the_end`];
  for (const t of targets) {
    const p = path.join(sDir, t);
    if (p.startsWith(sDir)) await fsp.rm(p, { recursive: true, force: true });
  }
  return targets;
}

module.exports = {
  instancesRoot,
  instanceDir,
  serverDir,
  resetWorld,
  listInstances,
  getInstance,
  saveInstance,
  deleteInstance,
  createInstance,
  importPackFile
};
