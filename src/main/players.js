const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { fetchJson } = require('./util');
const instances = require('./instances');
const mods = require('./mods');

/* ---------------- oyuncu giriş/çıkış kayıtları ---------------- */

function eventsPath(instanceId) {
  return path.join(instances.instanceDir(instanceId), 'player-events.json');
}

function readEvents(instanceId) {
  try {
    return JSON.parse(fs.readFileSync(eventsPath(instanceId), 'utf8'));
  } catch (_e) {
    return [];
  }
}

function appendEvent(instanceId, name, action) {
  const events = readEvents(instanceId);
  events.push({ name, action, at: new Date().toISOString() });
  if (events.length > 500) events.splice(0, events.length - 500);
  try {
    fs.writeFileSync(eventsPath(instanceId), JSON.stringify(events));
  } catch (_e) { /* kayıt tutulamadıysa görmezden gel */ }
}

/* ---------------- UUID çözümleme ---------------- */

/** Kırık (offline) modda Minecraft'ın kullandığı deterministik UUID. */
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // sürüm 3
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function resolveUuid(instanceId, name) {
  const props = await mods.getProperties(instanceId);
  const onlineMode = props['online-mode'] !== 'false';
  if (onlineMode) {
    try {
      const data = await fetchJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
      const id = data.id;
      return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
    } catch (_e) {
      throw new Error(`"${name}" adlı oyuncu Mojang'da bulunamadı. (online-mode kapalıysa isim yeterlidir)`);
    }
  }
  return offlineUuid(name);
}

/* ---------------- whitelist / ops json yönetimi ---------------- */

function jsonListPath(instanceId, file) {
  return path.join(instances.serverDir(instanceId), file);
}

async function readJsonList(instanceId, file) {
  try {
    return JSON.parse(await fsp.readFile(jsonListPath(instanceId, file), 'utf8'));
  } catch (_e) {
    return [];
  }
}

async function writeJsonList(instanceId, file, list) {
  await fsp.writeFile(jsonListPath(instanceId, file), JSON.stringify(list, null, 2));
}

/** Sunucu çalışıyorsa konsol komutu gönderir (dosya değişikliğini anında uygulamak için). */
function sendIfRunning(instanceId, command) {
  const serverproc = require('./serverproc');
  if (serverproc.status(instanceId) !== 'stopped') {
    try { serverproc.sendCommand(instanceId, command); } catch (_e) { /* önemsiz */ }
  }
}

async function getPlayersInfo(instanceId) {
  const serverproc = require('./serverproc');
  const props = await mods.getProperties(instanceId);
  return {
    online: serverproc.onlinePlayers(instanceId),
    events: readEvents(instanceId).slice(-200).reverse(),
    whitelist: await readJsonList(instanceId, 'whitelist.json'),
    ops: await readJsonList(instanceId, 'ops.json'),
    whitelistEnabled: props['white-list'] === 'true',
    onlineMode: props['online-mode'] !== 'false'
  };
}

async function whitelistAdd(instanceId, name) {
  const uuid = await resolveUuid(instanceId, name);
  const list = await readJsonList(instanceId, 'whitelist.json');
  if (!list.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    list.push({ uuid, name });
    await writeJsonList(instanceId, 'whitelist.json', list);
  }
  sendIfRunning(instanceId, 'whitelist reload');
  return list;
}

async function whitelistRemove(instanceId, name) {
  let list = await readJsonList(instanceId, 'whitelist.json');
  list = list.filter((e) => e.name.toLowerCase() !== name.toLowerCase());
  await writeJsonList(instanceId, 'whitelist.json', list);
  sendIfRunning(instanceId, 'whitelist reload');
  return list;
}

async function whitelistToggle(instanceId, enabled) {
  await mods.setProperties(instanceId, { 'white-list': enabled ? 'true' : 'false' });
  sendIfRunning(instanceId, enabled ? 'whitelist on' : 'whitelist off');
}

async function opAdd(instanceId, name) {
  const uuid = await resolveUuid(instanceId, name);
  const list = await readJsonList(instanceId, 'ops.json');
  if (!list.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    list.push({ uuid, name, level: 4, bypassesPlayerLimit: false });
    await writeJsonList(instanceId, 'ops.json', list);
  }
  sendIfRunning(instanceId, `op ${name}`);
  return list;
}

async function opRemove(instanceId, name) {
  let list = await readJsonList(instanceId, 'ops.json');
  list = list.filter((e) => e.name.toLowerCase() !== name.toLowerCase());
  await writeJsonList(instanceId, 'ops.json', list);
  sendIfRunning(instanceId, `deop ${name}`);
  return list;
}

module.exports = {
  appendEvent,
  getPlayersInfo,
  whitelistAdd,
  whitelistRemove,
  whitelistToggle,
  opAdd,
  opRemove
};
