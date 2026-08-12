const { fetchJson, runLimited } = require('./util');
const settings = require('./settings');

const GAME_MINECRAFT = 432;
const CLASS_MODPACKS = 4471;
const CLASS_MODS = 6;

/**
 * Resmî API anahtarı ayarlarda tanımlıysa api.curseforge.com kullanılır,
 * yoksa anahtarsız çalışan curse.tools proxy'sine düşülür.
 */
function apiConfig() {
  const key = settings.get().curseforgeApiKey;
  if (key) {
    return { base: 'https://api.curseforge.com/v1', headers: { 'x-api-key': key }, hasKey: true };
  }
  return { base: 'https://api.curse.tools/v1/cf', headers: {}, hasKey: false };
}

async function cfJson(pathPart) {
  const { base, headers } = apiConfig();
  return fetchJson(`${base}${pathPart}`, { headers });
}

async function cfPostJson(pathPart, body) {
  const { base, headers } = apiConfig();
  return fetchJson(`${base}${pathPart}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/** Diziyi chunkSize'lık parçalara böler. */
function chunk(arr, chunkSize) {
  const out = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

function mapMod(m) {
  return {
    source: 'curseforge',
    id: m.id,
    slug: m.slug,
    name: m.name,
    description: m.summary,
    icon: m.logo ? m.logo.thumbnailUrl : null,
    downloads: m.downloadCount,
    author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    categories: (m.categories || []).map((c) => c.name)
  };
}

async function searchPacks(query) {
  const data = await cfJson(
    `/mods/search?gameId=${GAME_MINECRAFT}&classId=${CLASS_MODPACKS}&searchFilter=${encodeURIComponent(query)}&sortField=2&sortOrder=desc&pageSize=24`
  );
  return data.data.map(mapMod);
}

function mapFile(f) {
  const loaders = [];
  const mcVersions = [];
  for (const gv of f.gameVersions || []) {
    if (/^\d+\.\d+(\.\d+)?$/.test(gv)) mcVersions.push(gv);
    else loaders.push(gv.toLowerCase());
  }
  return {
    id: f.id,
    modId: f.modId,
    name: f.displayName,
    versionNumber: f.displayName,
    fileName: f.fileName,
    mcVersions,
    loaders,
    datePublished: f.fileDate,
    serverPackFileId: f.serverPackFileId || null,
    downloadUrl: f.downloadUrl || null
  };
}

async function getPackVersions(modId) {
  const data = await cfJson(`/mods/${modId}/files?pageSize=50`);
  return data.data
    .sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))
    .map(mapFile);
}

async function getFile(modId, fileId) {
  const data = await cfJson(`/mods/${modId}/files/${fileId}`);
  return data.data;
}

async function getMod(modId) {
  const data = await cfJson(`/mods/${modId}`);
  return data.data;
}

/**
 * Manifest dosya listesi için file bilgilerini toplar.
 * Resmi API anahtarı varsa POST batch; yoksa (curse.tools) paralel tekil istek.
 * Eski sıralı döngü 40/469'da takılıyor gibi görünüyordu.
 */
async function getFilesForManifest(entries, onProgress) {
  const byId = new Map();
  const list = entries || [];
  const total = list.length;
  if (!total) return byId;

  const { hasKey } = apiConfig();
  if (hasKey) {
    try {
      const fileIds = [...new Set(list.map((e) => Number(e.fileID)).filter(Boolean))];
      let done = 0;
      for (const ids of chunk(fileIds, 50)) {
        const data = await cfPostJson('/mods/files', { fileIds: ids });
        for (const f of data.data || []) byId.set(f.id, f);
        done += ids.length;
        if (onProgress) onProgress(Math.min(done, total), total);
      }
      return byId;
    } catch (_e) {
      // batch yoksa tekile düş
    }
  }

  let done = 0;
  await runLimited(list, 12, async (e) => {
    try {
      const f = await getFile(e.projectID, e.fileID);
      if (f) byId.set(f.id || e.fileID, f);
    } catch (_err) { /* sonra failed */ }
    finally {
      done++;
      if (onProgress) onProgress(done, total);
    }
  });
  return byId;
}

/** Mod bilgilerini toplar — anahtar varsa batch, yoksa paralel getMod. */
async function getModsByIds(modIds, onProgress) {
  const unique = [...new Set(modIds.map(Number).filter(Boolean))];
  const byId = new Map();
  if (!unique.length) return byId;

  const { hasKey } = apiConfig();
  if (hasKey) {
    try {
      let done = 0;
      for (const ids of chunk(unique, 50)) {
        const data = await cfPostJson('/mods', { modIds: ids });
        for (const m of data.data || []) byId.set(m.id, m);
        done += ids.length;
        if (onProgress) onProgress(done, unique.length);
      }
      return byId;
    } catch (_e) { /* fallback */ }
  }

  let done = 0;
  await runLimited(unique, 12, async (id) => {
    try {
      const m = await getMod(id);
      if (m) byId.set(m.id || id, m);
    } catch (_err) { /* ignore */ }
    finally {
      done++;
      if (onProgress) onProgress(done, unique.length);
    }
  });
  return byId;
}

/** Dosya için indirilebilir URL bulur; API vermezse CDN adresini kendisi kurar. */
async function resolveDownloadUrl(modId, fileId, fileName) {
  try {
    const data = await cfJson(`/mods/${modId}/files/${fileId}/download-url`);
    if (data.data) return data.data;
  } catch (_e) {
    // download-url bazı modlarda kapalı; CDN fallback denenir
  }
  if (!fileName) {
    const f = await getFile(modId, fileId);
    fileName = f.fileName;
  }
  const idStr = String(fileId);
  return `https://edge.forgecdn.net/files/${idStr.slice(0, 4)}/${idStr.slice(4)}/${encodeURIComponent(fileName)}`;
}

async function searchMods(query, { loader, mcVersion } = {}) {
  const loaderIds = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
  let url = `/mods/search?gameId=${GAME_MINECRAFT}&classId=${CLASS_MODS}&searchFilter=${encodeURIComponent(query)}&sortField=2&sortOrder=desc&pageSize=24`;
  if (mcVersion) url += `&gameVersion=${encodeURIComponent(mcVersion)}`;
  if (loader && loaderIds[loader]) url += `&modLoaderType=${loaderIds[loader]}`;
  const data = await cfJson(url);
  return data.data.map(mapMod);
}

async function getModVersions(modId, { loader, mcVersion } = {}) {
  const loaderIds = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
  let url = `/mods/${modId}/files?pageSize=50`;
  if (mcVersion) url += `&gameVersion=${encodeURIComponent(mcVersion)}`;
  if (loader && loaderIds[loader]) url += `&modLoaderType=${loaderIds[loader]}`;
  const data = await cfJson(url);
  return data.data
    .sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))
    .map(mapFile);
}

module.exports = {
  searchPacks,
  getPackVersions,
  getFile,
  getMod,
  getFilesForManifest,
  getModsByIds,
  resolveDownloadUrl,
  searchMods,
  getModVersions
};
