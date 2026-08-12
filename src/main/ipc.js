const { ipcMain, dialog, shell } = require('electron');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const instances = require('./instances');
const serverproc = require('./serverproc');
const mods = require('./mods');
const javaMgr = require('./java');
const settings = require('./settings');
const players = require('./players');
const network = require('./network');

function registerIpc(getWindow) {
  const send = (channel, data) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };
  serverproc.setNotifier(send);

  const progressReporter = (instanceKey) => (message, current = 0, total = 0) => {
    send('install:progress', { key: instanceKey, message, current, total });
  };

  /* ---- modpack arama ---- */
  ipcMain.handle('packs:search', async (_e, { source, query }) => {
    if (source === 'curseforge') return curseforge.searchPacks(query);
    return modrinth.searchPacks(query);
  });

  ipcMain.handle('packs:versions', async (_e, { source, projectId }) => {
    if (source === 'curseforge') return curseforge.getPackVersions(projectId);
    return modrinth.getPackVersions(projectId);
  });

  /* ---- instance ---- */
  ipcMain.handle('instances:create', async (_e, payload) => {
    return instances.createInstance(payload, progressReporter(payload.progressKey || 'create'));
  });

  ipcMain.handle('instances:import-file', async (_e, payload) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Modpack dosyası seç',
      filters: [{ name: 'Modpack', extensions: ['mrpack', 'zip'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return instances.importPackFile(
      { ...payload, filePath: result.filePaths[0] },
      progressReporter(payload.progressKey || 'create')
    );
  });

  ipcMain.handle('instances:list', async () => {
    const list = await instances.listInstances();
    return list.map((m) => ({ ...m, runStatus: serverproc.status(m.id) }));
  });

  ipcMain.handle('instances:get', async (_e, { id }) => {
    const meta = await instances.getInstance(id);
    return { ...meta, runStatus: serverproc.status(id) };
  });

  ipcMain.handle('instances:delete', async (_e, { id }) => {
    serverproc.kill(id);
    await instances.deleteInstance(id);
  });

  ipcMain.handle('instances:update', async (_e, { id, updates }) => {
    const meta = await instances.getInstance(id);
    const allowed = ['name', 'memoryMb', 'javaPath', 'eulaAccepted'];
    for (const key of allowed) {
      if (key in updates) meta[key] = updates[key];
    }
    if (updates.eulaAccepted) {
      const fsp = require('fs/promises');
      const path = require('path');
      await fsp.writeFile(path.join(instances.serverDir(id), 'eula.txt'), 'eula=true\n');
    }
    return instances.saveInstance(meta);
  });

  ipcMain.handle('instances:open-folder', async (_e, { id }) => {
    shell.openPath(instances.serverDir(id));
  });

  /* ---- sunucu süreci ---- */
  ipcMain.handle('server:start', (_e, { id }) => serverproc.start(id));
  ipcMain.handle('server:stop', (_e, { id }) => serverproc.stop(id));
  ipcMain.handle('server:kill', (_e, { id }) => serverproc.kill(id));
  ipcMain.handle('server:command', (_e, { id, command }) => serverproc.sendCommand(id, command));
  ipcMain.handle('server:status', (_e, { id }) => serverproc.status(id));
  ipcMain.handle('server:console-buffer', (_e, { id }) => serverproc.consoleBuffer(id));

  /* ---- modlar ---- */
  ipcMain.handle('mods:list', (_e, { id }) => mods.listMods(id));
  ipcMain.handle('mods:search', (_e, payload) => mods.searchMods(payload));
  ipcMain.handle('mods:versions', (_e, payload) => mods.getModVersions(payload));
  ipcMain.handle('mods:install', (_e, payload) => mods.installMod(payload));

  ipcMain.handle('mods:add-file', async (_e, { id }) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Mod dosyaları seç',
      filters: [{ name: 'Mod (jar)', extensions: ['jar'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    const added = [];
    for (const p of result.filePaths) {
      added.push(await mods.addModFromFile(id, p));
    }
    return added;
  });

  ipcMain.handle('mods:toggle', (_e, { id, fileName }) => mods.toggleMod(id, fileName));
  ipcMain.handle('mods:delete', (_e, { id, fileName }) => mods.deleteMod(id, fileName));

  /* ---- java ---- */
  ipcMain.handle('java:list', () => javaMgr.listJava());
  ipcMain.handle('java:download', async (_e, { major }) => {
    return javaMgr.downloadJava(major, (recv, total) => {
      send('install:progress', {
        key: 'java',
        message: total ? `Java ${major} indiriliyor (%${Math.round((recv / total) * 100)})` : `Java ${major} indiriliyor...`,
        current: recv,
        total
      });
    });
  });

  /* ---- oyuncular ---- */
  ipcMain.handle('players:info', (_e, { id }) => players.getPlayersInfo(id));
  ipcMain.handle('whitelist:add', (_e, { id, name }) => players.whitelistAdd(id, name));
  ipcMain.handle('whitelist:remove', (_e, { id, name }) => players.whitelistRemove(id, name));
  ipcMain.handle('whitelist:toggle', (_e, { id, enabled }) => players.whitelistToggle(id, enabled));
  ipcMain.handle('ops:add', (_e, { id, name }) => players.opAdd(id, name));
  ipcMain.handle('ops:remove', (_e, { id, name }) => players.opRemove(id, name));

  /* ---- ağ ---- */
  ipcMain.handle('net:info', (_e, { id }) => network.netInfo(id));

  /* ---- dünya ---- */
  ipcMain.handle('world:reset', async (_e, { id }) => {
    if (serverproc.status(id) !== 'stopped') {
      throw new Error('Dünyayı sıfırlamak için önce sunucuyu durdur.');
    }
    return instances.resetWorld(id);
  });

  /* ---- server.properties ---- */
  ipcMain.handle('props:get', (_e, { id }) => mods.getProperties(id));
  ipcMain.handle('props:set', (_e, { id, updates }) => mods.setProperties(id, updates));

  /* ---- ayarlar ---- */
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, partial) => settings.set(partial));
}

module.exports = { registerIpc };
