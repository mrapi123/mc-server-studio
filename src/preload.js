const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  // modpack arama / sürümler
  searchPacks: invoke('packs:search'),
  getPackVersions: invoke('packs:versions'),

  // instance yönetimi
  createInstance: invoke('instances:create'),
  importPackFile: invoke('instances:import-file'),
  listInstances: invoke('instances:list'),
  getInstance: invoke('instances:get'),
  deleteInstance: invoke('instances:delete'),
  updateInstance: invoke('instances:update'),
  openInstanceFolder: invoke('instances:open-folder'),

  // sunucu süreci
  startServer: invoke('server:start'),
  stopServer: invoke('server:stop'),
  killServer: invoke('server:kill'),
  sendCommand: invoke('server:command'),
  getServerStatus: invoke('server:status'),
  getConsoleBuffer: invoke('server:console-buffer'),

  // modlar
  listMods: invoke('mods:list'),
  searchMods: invoke('mods:search'),
  getModVersions: invoke('mods:versions'),
  installMod: invoke('mods:install'),
  addModFromFile: invoke('mods:add-file'),
  toggleMod: invoke('mods:toggle'),
  deleteMod: invoke('mods:delete'),

  // oyuncular
  getPlayersInfo: invoke('players:info'),
  whitelistAdd: invoke('whitelist:add'),
  whitelistRemove: invoke('whitelist:remove'),
  whitelistToggle: invoke('whitelist:toggle'),
  opAdd: invoke('ops:add'),
  opRemove: invoke('ops:remove'),

  // ağ bilgisi
  getNetInfo: invoke('net:info'),

  // java
  listJava: invoke('java:list'),
  downloadJava: invoke('java:download'),

  // server.properties
  getProperties: invoke('props:get'),
  setProperties: invoke('props:set'),

  // ayarlar
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),

  // olaylar
  onInstallProgress: (cb) => ipcRenderer.on('install:progress', (_e, data) => cb(data)),
  onServerLog: (cb) => ipcRenderer.on('server:log', (_e, data) => cb(data)),
  onServerStatus: (cb) => ipcRenderer.on('server:status-change', (_e, data) => cb(data)),
  onServerPlayers: (cb) => ipcRenderer.on('server:players', (_e, data) => cb(data))
});
