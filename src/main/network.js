const os = require('os');
const mods = require('./mods');

let publicIpCache = { value: null, at: 0 };

function localIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        out.push({ iface: name, ip: a.address });
      }
    }
  }
  return out;
}

async function publicIp() {
  if (publicIpCache.value && Date.now() - publicIpCache.at < 5 * 60 * 1000) {
    return publicIpCache.value;
  }
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    publicIpCache = { value: j.ip, at: Date.now() };
    return j.ip;
  } catch (_e) {
    return null;
  }
}

async function netInfo(instanceId) {
  const props = await mods.getProperties(instanceId);
  return {
    port: props['server-port'] || '25565',
    local: localIps(),
    public: await publicIp()
  };
}

module.exports = { netInfo };
