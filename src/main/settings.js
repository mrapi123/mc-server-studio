const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  curseforgeApiKey: '',
  defaultMemoryMb: 4096
};

let cache = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function get() {
  if (!cache) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
    } catch (_e) {
      cache = { ...DEFAULTS };
    }
  }
  return cache;
}

function set(partial) {
  cache = { ...get(), ...partial };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { get, set };
