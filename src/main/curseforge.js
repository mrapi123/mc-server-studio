const { fetchJson } = require('./util');
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
    return { base: 'https://api.curseforge.com/v1', headers: { 'x-api-key': key } };
  }
  return { base: 'https://api.curse.tools/v1/cf', headers: {} };
}

async function cfJson(pathPart) {
  const { base, headers } = apiConfig();
  return fetchJson(`${base}${pathPart}`, { headers });
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
  resolveDownloadUrl,
  searchMods,
  getModVersions
};
