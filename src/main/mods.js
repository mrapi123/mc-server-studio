const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { downloadFile } = require('./util');
const instances = require('./instances');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');

function modsDir(instanceId) {
  return path.join(instances.serverDir(instanceId), 'mods');
}

async function listMods(instanceId) {
  const dir = modsDir(instanceId);
  let files = [];
  try {
    files = await fsp.readdir(dir);
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.jar') && !f.endsWith('.jar.disabled')) continue;
    const stat = await fsp.stat(path.join(dir, f));
    out.push({
      fileName: f,
      enabled: f.endsWith('.jar'),
      sizeMb: +(stat.size / (1024 * 1024)).toFixed(2)
    });
  }
  return out.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

async function searchMods({ source, query, loader, mcVersion }) {
  if (source === 'curseforge') return curseforge.searchMods(query, { loader, mcVersion });
  return modrinth.searchMods(query, { loader, mcVersion });
}

async function getModVersions({ source, projectId, loader, mcVersion }) {
  if (source === 'curseforge') return curseforge.getModVersions(projectId, { loader, mcVersion });
  return modrinth.getModVersions(projectId, { loader, mcVersion });
}

async function installMod({ instanceId, source, projectId, versionId, fileName, fileUrl }) {
  const dir = modsDir(instanceId);
  await fsp.mkdir(dir, { recursive: true });

  if (source === 'curseforge') {
    const url = await curseforge.resolveDownloadUrl(projectId, versionId, fileName);
    await downloadFile(url, path.join(dir, fileName));
  } else {
    await downloadFile(fileUrl, path.join(dir, fileName));
  }
  return { fileName };
}

async function addModFromFile(instanceId, filePath) {
  const dir = modsDir(instanceId);
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(filePath));
  await fsp.copyFile(filePath, dest);
  return { fileName: path.basename(filePath) };
}

async function toggleMod(instanceId, fileName) {
  const dir = modsDir(instanceId);
  const from = path.join(dir, fileName);
  const to = fileName.endsWith('.disabled')
    ? path.join(dir, fileName.slice(0, -'.disabled'.length))
    : path.join(dir, fileName + '.disabled');
  await fsp.rename(from, to);
  return { fileName: path.basename(to) };
}

async function deleteMod(instanceId, fileName) {
  await fsp.unlink(path.join(modsDir(instanceId), fileName));
}

/* ---------------- server.properties ---------------- */

function propsPath(instanceId) {
  return path.join(instances.serverDir(instanceId), 'server.properties');
}

async function getProperties(instanceId) {
  const props = {};
  try {
    const raw = await fsp.readFile(propsPath(instanceId), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx > 0) props[line.slice(0, idx)] = line.slice(idx + 1);
    }
  } catch (_e) { /* henüz oluşmamış */ }
  return props;
}

async function setProperties(instanceId, updates) {
  const file = propsPath(instanceId);
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
  return getProperties(instanceId);
}

module.exports = {
  listMods,
  searchMods,
  getModVersions,
  installMod,
  addModFromFile,
  toggleMod,
  deleteMod,
  getProperties,
  setProperties
};
