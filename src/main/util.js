const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const USER_AGENT = 'mc-server-studio/1.0.0 (yerel sunucu yoneticisi)';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} - ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

async function downloadFile(url, destPath, onProgress) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`İndirme başarısız (HTTP ${res.status}): ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const tmpPath = destPath + '.part';
  const fileStream = fs.createWriteStream(tmpPath);
  let received = 0;

  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (onProgress) onProgress(received, total);
      if (!fileStream.write(Buffer.from(value))) {
        await new Promise((r) => fileStream.once('drain', r));
      }
    }
  } finally {
    await new Promise((r) => fileStream.end(r));
  }
  await fsp.rename(tmpPath, destPath);
}

/** Sınırlı eşzamanlılıkla görev çalıştırır. */
async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(next());
  await Promise.all(workers);
  return results;
}

async function copyDirInto(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  await fsp.cp(srcDir, destDir, { recursive: true, force: true });
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9-_ğüşöçıİĞÜŞÖÇ ]/g, '').trim().slice(0, 60) || 'sunucu';
}

module.exports = { fetchJson, downloadFile, runLimited, copyDirInto, sanitizeName, USER_AGENT };
