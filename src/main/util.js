const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const USER_AGENT = `mc-server-studio/${require('../../package.json').version} (yerel sunucu yoneticisi)`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatFetchError(err, url) {
  const cause = err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : '';
  return `Ağ hatası: ${url}${cause}. İnternet bağlantını kontrol edip tekrar dene.`;
}

/** JSON/API istekleri için (kısa timeout). */
async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(options.headers || {}) },
        signal: options.signal || AbortSignal.timeout(45000)
      });
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(800 * attempt);
    }
  }
  throw new Error(formatFetchError(lastErr, url));
}

async function fetchJson(url, options = {}) {
  const res = await fetchWithRetry(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} - ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Büyük dosya indirme — timeout yok, mümkünse Range ile devam eder.
 * Node http(s) kullanır (fetch body timeout sorununu önlemek için).
 */
function downloadWithHttp(url, destPath, onProgress, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + '.part';
    let existing = 0;
    try {
      if (fs.existsSync(tmpPath)) existing = fs.statSync(tmpPath).size;
    } catch (_e) { existing = 0; }

    const headers = { 'User-Agent': USER_AGENT };
    if (existing > 0) headers.Range = `bytes=${existing}-`;

    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, { headers, timeout: 120000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Çok fazla yönlendirme'));
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadWithHttp(next, destPath, onProgress, redirectsLeft - 1));
      }

      // Sunucu Range desteklemiyorsa baştan indir
      if (existing > 0 && res.statusCode === 200) {
        existing = 0;
        try { fs.unlinkSync(tmpPath); } catch (_e) { /* ignore */ }
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(new Error(`İndirme başarısız (HTTP ${res.statusCode}): ${url}`));
      }

      const contentLength = Number(res.headers['content-length']) || 0;
      const total = res.statusCode === 206
        ? existing + contentLength
        : contentLength;
      let received = existing;

      const stream = fs.createWriteStream(tmpPath, { flags: existing > 0 && res.statusCode === 206 ? 'a' : 'w' });
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress(received, total);
      });
      res.pipe(stream);
      stream.on('finish', async () => {
        try {
          await fsp.rename(tmpPath, destPath);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      stream.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      // soket zaman aşımı — bağlantıyı kes, üst katman tekrar dener (resume ile)
      req.destroy();
      reject(new Error('İndirme bağlantı zaman aşımı (kaldığı yerden devam edilecek)'));
    });
  });
}

async function downloadFile(url, destPath, onProgress) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await downloadWithHttp(url, destPath, onProgress);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 5) await sleep(1500 * attempt);
    }
  }
  throw new Error(lastErr?.message || formatFetchError(lastErr, url));
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
