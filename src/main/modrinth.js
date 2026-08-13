const { fetchJson } = require('./util');

const BASE = 'https://api.modrinth.com/v2';

async function searchPacks(query) {
  const facets = encodeURIComponent(JSON.stringify([['project_type:modpack']]));
  const data = await fetchJson(
    `${BASE}/search?query=${encodeURIComponent(query)}&facets=${facets}&limit=24&index=relevance`
  );
  return data.hits.map((h) => ({
    source: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    name: h.title,
    description: h.description,
    icon: h.icon_url,
    downloads: h.downloads,
    author: h.author,
    categories: h.categories || []
  }));
}

async function getPackVersions(projectId) {
  const versions = await fetchJson(`${BASE}/project/${projectId}/version`);
  return versions
    .filter((v) => (v.files || []).some((f) => f.filename.endsWith('.mrpack')))
    .map((v) => ({
      id: v.id,
      name: v.name,
      versionNumber: v.version_number,
      mcVersions: v.game_versions || [],
      loaders: v.loaders || [],
      datePublished: v.date_published,
      fileName: (v.files.find((f) => f.primary) || v.files[0]).filename,
      fileUrl: (v.files.find((f) => f.primary) || v.files[0]).url
    }));
}

const KNOWN_LOADERS = new Set(['forge', 'fabric', 'quilt', 'neoforge']);

function normalizeLoader(loader) {
  const l = String(loader || '').toLowerCase().trim();
  return KNOWN_LOADERS.has(l) ? l : null;
}

function mapModHit(h) {
  return {
    source: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    name: h.title,
    description: h.description,
    icon: h.icon_url,
    downloads: h.downloads,
    author: h.author,
    clientSide: h.client_side,
    serverSide: h.server_side
  };
}

async function searchMods(query, { loader, mcVersion } = {}) {
  const q = String(query || '').trim();
  const loaderNorm = normalizeLoader(loader);
  const mc = String(mcVersion || '').trim() || null;

  async function run(useLoader, useMc) {
    const facets = [['project_type:mod']];
    if (useLoader) facets.push([`categories:${useLoader}`]);
    if (useMc) facets.push([`versions:${useMc}`]);
    const encoded = encodeURIComponent(JSON.stringify(facets));
    const data = await fetchJson(
      `${BASE}/search?query=${encodeURIComponent(q)}&facets=${encoded}&limit=24&index=relevance`
    );
    return (data.hits || []).map(mapModHit);
  }

  let hits = await run(loaderNorm, mc);
  // Sıkı filtre 0 sonuç verirse (yanlış loader/sürüm) genişlet
  if (!hits.length && (loaderNorm || mc)) {
    hits = await run(loaderNorm, null);
  }
  if (!hits.length && loaderNorm) {
    hits = await run(null, mc);
  }
  if (!hits.length && (loaderNorm || mc)) {
    hits = await run(null, null);
  }
  return hits;
}

async function getModVersions(projectId, { loader, mcVersion } = {}) {
  const loaderNorm = normalizeLoader(loader);
  const mc = String(mcVersion || '').trim() || null;

  async function run(useLoader, useMc) {
    const params = [];
    if (useLoader) params.push(`loaders=${encodeURIComponent(JSON.stringify([useLoader]))}`);
    if (useMc) params.push(`game_versions=${encodeURIComponent(JSON.stringify([useMc]))}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const versions = await fetchJson(`${BASE}/project/${projectId}/version${qs}`);
    return versions || [];
  }

  let versions = await run(loaderNorm, mc);
  if (!versions.length && (loaderNorm || mc)) versions = await run(loaderNorm, null);
  if (!versions.length && loaderNorm) versions = await run(null, mc);
  if (!versions.length && (loaderNorm || mc)) versions = await run(null, null);

  return versions.map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    mcVersions: v.game_versions || [],
    loaders: v.loaders || [],
    datePublished: v.date_published,
    fileName: (v.files.find((f) => f.primary) || v.files[0]).filename,
    fileUrl: (v.files.find((f) => f.primary) || v.files[0]).url
  }));
}

module.exports = { searchPacks, getPackVersions, searchMods, getModVersions };
