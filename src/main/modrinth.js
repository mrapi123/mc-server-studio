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

async function searchMods(query, { loader, mcVersion } = {}) {
  const facets = [['project_type:mod']];
  if (loader) facets.push([`categories:${loader}`]);
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  const encoded = encodeURIComponent(JSON.stringify(facets));
  const data = await fetchJson(
    `${BASE}/search?query=${encodeURIComponent(query)}&facets=${encoded}&limit=24&index=relevance`
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
    clientSide: h.client_side,
    serverSide: h.server_side
  }));
}

async function getModVersions(projectId, { loader, mcVersion } = {}) {
  const params = [];
  if (loader) params.push(`loaders=${encodeURIComponent(JSON.stringify([loader]))}`);
  if (mcVersion) params.push(`game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`);
  const versions = await fetchJson(`${BASE}/project/${projectId}/version?${params.join('&')}`);
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
