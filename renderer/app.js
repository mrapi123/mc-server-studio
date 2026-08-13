/* MC Server Studio - arayüz mantığı */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  instances: [],
  currentId: null,
  createSource: 'modrinth',
  selectedPack: null,
  packVersions: [],
  modSource: 'modrinth',
  installing: false,
  consoleCarry: '',
  cmdHistory: [],
  cmdHistoryIdx: -1
};

/* ---------------- yardımcılar ---------------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = message;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), isError ? 8000 : 4000);
}

function errMsg(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+':\s*/i, '');
}

function bindImgFallback(container) {
  container.querySelectorAll('img').forEach((img) => {
    if (!img.getAttribute('src')) img.style.visibility = 'hidden';
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  });
}

function fmtDownloads(n) {
  if (!n) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M indirme';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K indirme';
  return n + ' indirme';
}

function fmtTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? hm : d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}

function showView(name) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${name}`).classList.remove('hidden');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Kopyalandı: ' + text);
  } catch (_e) {
    toast('Kopyalanamadı', true);
  }
}

const STATUS_TR = {
  stopped: 'Kapalı',
  starting: 'Başlatılıyor...',
  running: 'Çalışıyor',
  stopping: 'Durduruluyor...'
};

const ICONS = {
  plus: '<svg><use href="#i-plus"/></svg>',
  trash: '<svg><use href="#i-trash"/></svg>',
  copy: '<svg><use href="#i-copy"/></svg>'
};

/* ---------------- kenar çubuğu ---------------- */

async function refreshInstances() {
  state.instances = await window.api.listInstances();
  const list = $('#instance-list');
  list.innerHTML = '';
  for (const inst of state.instances) {
    const item = document.createElement('div');
    item.className = 'instance-item' + (inst.id === state.currentId ? ' active' : '');
    item.innerHTML = `
      <img src="${esc(inst.icon || '')}" />
      <div class="ii-text">
        <div class="ii-name">${esc(inst.name)}</div>
        <div class="ii-sub">${esc(inst.mcVersion || '')} ${esc(inst.loader || '')}</div>
      </div>
      <div class="status-dot ${esc(inst.runStatus)}" data-dot="${esc(inst.id)}"></div>`;
    bindImgFallback(item);
    item.addEventListener('click', () => openInstance(inst.id));
    list.appendChild(item);
  }
}

/* ---------------- modpack arama ---------------- */

function switchCreateSource(source) {
  state.createSource = source;
  $$('#source-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.source === source));
  $('#search-panel').classList.toggle('hidden', source === 'file' || source === 'vanilla');
  $('#file-panel').classList.toggle('hidden', source !== 'file');
  $('#vanilla-panel').classList.toggle('hidden', source !== 'vanilla');
  if (source === 'vanilla') loadVanillaVersions();
}

async function loadVanillaVersions() {
  const sel = $('#vanilla-version');
  if (sel.dataset.loaded === '1') return;
  sel.innerHTML = '<option>Yükleniyor...</option>';
  try {
    const data = await window.api.listMcVersions();
    sel.innerHTML = data.versions
      .slice(0, 80)
      .map((v) => `<option value="${esc(v)}"${v === data.latest ? ' selected' : ''}>${esc(v)}${v === data.latest ? ' (son sürüm)' : ''}</option>`)
      .join('');
    sel.dataset.loaded = '1';
    $('#vanilla-name').value = `Vanilla ${data.latest}`;
  } catch (err) {
    sel.innerHTML = `<option value="">Hata: ${esc(err.message)}</option>`;
  }
}

async function startVanillaInstall() {
  const mcVersion = $('#vanilla-version').value;
  if (!mcVersion) return toast('Minecraft sürümü seç.', true);
  if (!$('#vanilla-eula').checked) return toast('Sunucu açmak için Mojang EULA kabul edilmeli.', true);

  beginInstallUI(`Vanilla ${mcVersion} kuruluyor...`);
  try {
    const inst = await window.api.createInstance({
      source: 'vanilla',
      mcVersion,
      name: $('#vanilla-name').value.trim() || `Vanilla ${mcVersion}`,
      memoryMb: Number($('#vanilla-memory').value) || 2048,
      eulaAccepted: true
    });
    finishInstallUI();
    await refreshInstances();
    openInstance(inst.id);
    toast('Vanilla sunucu kuruldu!');
  } catch (err) {
    finishInstallUI();
    showView('create');
    toast('Kurulum başarısız: ' + errMsg(err), true);
  }
}

async function doSearch() {
  const query = $('#search-input').value.trim();
  const results = $('#search-results');
  if (!query) {
    results.innerHTML = '<p class="muted">Aramak için bir şey yaz (örn. Better MC, Soulrend).</p>';
    $('#search-input').focus();
    return;
  }
  results.innerHTML = '<p class="muted">Aranıyor...</p>';
  try {
    let packs = await window.api.searchPacks({ source: state.createSource, query });
    let note = '';
    // Modrinth'te yoksa CurseForge'a düş (Soulrend vb.)
    if (!packs.length && state.createSource === 'modrinth') {
      packs = await window.api.searchPacks({ source: 'curseforge', query });
      if (packs.length) note = 'Modrinth\'te yok; CurseForge sonuçları gösteriliyor.';
    }
    if (!packs.length) {
      results.innerHTML = state.createSource === 'modrinth'
        ? '<p class="muted">Sonuç yok. <b>CurseForge</b> sekmesini dene.</p>'
        : '<p class="muted">Sonuç bulunamadı.</p>';
      return;
    }
    results.innerHTML = note ? `<p class="muted small">${note}</p>` : '';
    for (const pack of packs) {
      const card = document.createElement('div');
      card.className = 'pack-card';
      card.innerHTML = `
        <img src="${esc(pack.icon || '')}" />
        <div>
          <div class="pc-name">${esc(pack.name)}</div>
          <div class="pc-desc">${esc(pack.description)}</div>
          <div class="pc-meta"><span>${esc(pack.author)}</span><span>${fmtDownloads(pack.downloads)}</span></div>
        </div>`;
      bindImgFallback(card);
      card.addEventListener('click', () => openVersionModal(pack));
      results.appendChild(card);
    }
  } catch (err) {
    results.innerHTML = `<p class="muted">Arama hatası: ${esc(errMsg(err))}</p>`;
  }
}

/* ---------------- sürüm seçimi + kurulum ---------------- */

async function openVersionModal(pack) {
  state.selectedPack = pack;
  $('#mv-title').textContent = pack.name;
  $('#mv-name').value = pack.name;
  const settings = await window.api.getSettings();
  $('#mv-memory').value = settings.defaultMemoryMb || 4096;

  const sel = $('#mv-version');
  sel.innerHTML = '<option>Yükleniyor...</option>';
  $('#modal-version').classList.remove('hidden');

  try {
    const versions = await window.api.getPackVersions({ source: pack.source, projectId: pack.id });
    state.packVersions = versions;
    if (!versions.length) {
      sel.innerHTML = '<option value="">Uygun sürüm bulunamadı</option>';
      return;
    }
    sel.innerHTML = versions
      .slice(0, 40)
      .map((v) => {
        const mc = v.mcVersions.join(', ');
        const loaders = v.loaders.join(', ');
        return `<option value="${esc(v.id)}">${esc(v.versionNumber || v.name)} — MC ${esc(mc)} ${loaders ? '(' + esc(loaders) + ')' : ''}</option>`;
      })
      .join('');
  } catch (err) {
    sel.innerHTML = `<option value="">Hata: ${esc(err.message)}</option>`;
  }
}

async function startInstall() {
  const pack = state.selectedPack;
  const versionId = $('#mv-version').value;
  if (!pack || !versionId) return toast('Lütfen bir sürüm seç.', true);
  if (!$('#mv-eula').checked) return toast('Sunucu açmak için Mojang EULA kabul edilmeli.', true);

  const payload = {
    source: pack.source,
    projectId: pack.id,
    name: $('#mv-name').value.trim() || pack.name,
    memoryMb: Number($('#mv-memory').value) || 4096,
    eulaAccepted: true,
    packIcon: pack.icon
  };
  if (pack.source === 'curseforge') payload.fileId = Number(versionId);
  else payload.versionId = versionId;

  $('#modal-version').classList.add('hidden');
  beginInstallUI(`"${payload.name}" kuruluyor...`);

  try {
    const inst = await window.api.createInstance(payload);
    finishInstallUI();
    await refreshInstances();
    openInstance(inst.id);
    toast('Sunucu kuruldu! Başlat butonuyla açabilirsin.');
    if (inst.failedMods && inst.failedMods.length) {
      toast(`${inst.failedMods.length} mod otomatik indirilemedi. Detay: sunucu sayfasındaki uyarıya bak.`, true);
    }
  } catch (err) {
    finishInstallUI();
    showView('create');
    toast('Kurulum başarısız: ' + errMsg(err), true);
  }
}

async function importFromFile() {
  beginInstallUI('Dosyadan kuruluyor...');
  try {
    const settings = await window.api.getSettings();
    const inst = await window.api.importPackFile({
      name: '',
      memoryMb: settings.defaultMemoryMb || 4096,
      eulaAccepted: true
    });
    finishInstallUI();
    if (!inst) {
      showView('create');
      return;
    }
    await refreshInstances();
    openInstance(inst.id);
    toast('Sunucu kuruldu!');
  } catch (err) {
    finishInstallUI();
    showView('create');
    toast('Kurulum başarısız: ' + errMsg(err), true);
  }
}

function beginInstallUI(title) {
  state.installing = true;
  $('#install-title').textContent = title;
  $('#install-message').textContent = 'Başlatılıyor...';
  $('#install-progress-fill').style.width = '0%';
  showView('installing');
}

function finishInstallUI() {
  state.installing = false;
}

window.api.onInstallProgress((data) => {
  if (!state.installing) return;
  $('#install-message').textContent = data.message;
  if (data.total > 0) {
    $('#install-progress-fill').style.width = Math.round((data.current / data.total) * 100) + '%';
  }
});

/* ---------------- sunucu detay ---------------- */

async function openInstance(id) {
  state.currentId = id;
  let inst;
  try {
    inst = await window.api.getInstance({ id });
  } catch (_e) {
    return;
  }

  $('#inst-name').textContent = inst.name;
  const iconEl = $('#inst-icon');
  iconEl.style.visibility = inst.icon ? 'visible' : 'hidden';
  if (inst.icon) iconEl.src = inst.icon;
  $('#inst-pack').textContent = inst.packName || inst.source;
  $('#inst-mc').textContent = 'MC ' + (inst.mcVersion || '?');
  $('#inst-loader').textContent = (inst.loader || '') + ' ' + (inst.loaderVersion || '');
  updateStatusUI(inst.runStatus);

  // uyarılar
  const warn = $('#inst-warning');
  const warnings = [];
  if (inst.status === 'failed') warnings.push('Kurulum hatası: ' + esc(inst.error || 'bilinmiyor') + ' — silip yeniden kur.');
  if (inst.status === 'installing') warnings.push('Kurulum yarım kalmış görünüyor. Silip tekrar kurmayı dene.');
  if (!inst.eulaAccepted) warnings.push('Mojang EULA kabul edilmedi — Ayarlar sekmesinden onaylamadan sunucu açılmaz.');
  if (inst.failedMods && inst.failedMods.length) {
    const names = inst.failedMods.map((m) => esc(m.name)).join(', ');
    warnings.push(`Şu modlar otomatik indirilemedi (dağıtım kısıtlaması): <b>${names}</b>. ` +
      'Bunları CurseForge sitesinden elle indirip "Modlar > Dosyadan Ekle" ile ekleyebilirsin.');
  }
  warn.innerHTML = warnings.join('<br>');
  warn.classList.toggle('hidden', warnings.length === 0);

  $('#btn-start').disabled = inst.status === 'failed' || inst.status === 'installing';

  // konsol geçmişini yükle
  const buffer = await window.api.getConsoleBuffer({ id });
  resetConsole(buffer);

  switchInstanceTab('console');
  showView('instance');
  refreshInstances();
  loadModsTab();
  loadPlayersTab();
  loadConnectionTab();
  loadSettingsTab(inst);
}

function updateStatusUI(status) {
  const chip = $('#inst-status');
  chip.textContent = STATUS_TR[status] || status;
  chip.className = 'chip status-chip ' + status;
  $('#btn-start').classList.toggle('hidden', status !== 'stopped');
  $('#btn-stop').classList.toggle('hidden', status === 'stopped');
  if (status === 'stopped') {
    $('#inst-players-chip').classList.add('hidden');
  }
}

function switchInstanceTab(tab) {
  $$('#inst-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  for (const name of ['console', 'players', 'mods', 'connection', 'settings']) {
    $(`#tab-${name}`).classList.toggle('hidden', name !== tab);
  }
  if (tab === 'players') loadPlayersTab();
  if (tab === 'connection') loadConnectionTab();
}

/* ---------------- konsol ---------------- */

function lineClass(line) {
  if (line.startsWith('> ')) return 'cmd';
  if (line.startsWith('[Sunucu') || line.startsWith('[Hata')) return 'meta';
  if (/ERROR|SEVERE|FATAL|Exception|\tat /.test(line)) return 'error';
  if (/Can't keep up|Can't keep up!|Running \d+ms or \d+ ticks behind/i.test(line)) return 'lag';
  if (/WARN/.test(line)) return 'warn';
  if (/Done \(/.test(line)) return 'done';
  return '';
}

let lastLagToastAt = 0;
function maybeWarnLag(text) {
  if (!/Can't keep up|ticks behind/i.test(text)) return;
  const now = Date.now();
  if (now - lastLagToastAt < 60000) return; // spam engelle
  lastLagToastAt = now;
  toast(
    "Sunucu yavaşlıyor (Can't keep up). RAM artır, Ayarlar → Görüş & Chunk'ı düşür (örn. 8/6), arka plandaki programları kapat.",
    true
  );
}

function appendConsoleLines(text) {
  const out = $('#console-output');
  const nearBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 80;

  const full = state.consoleCarry + text;
  const parts = full.split('\n');
  state.consoleCarry = parts.pop();

  const frag = document.createDocumentFragment();
  for (const line of parts) {
    const div = document.createElement('div');
    div.className = 'cline ' + lineClass(line);
    div.textContent = line || ' ';
    frag.appendChild(div);
  }
  out.appendChild(frag);
  maybeWarnLag(text);

  while (out.childElementCount > 1500) out.removeChild(out.firstElementChild);
  if (nearBottom) out.scrollTop = out.scrollHeight;
}

function resetConsole(buffer) {
  const out = $('#console-output');
  out.innerHTML = '';
  state.consoleCarry = '';
  if (buffer) {
    appendConsoleLines(buffer.endsWith('\n') ? buffer : buffer + '\n');
  } else {
    const div = document.createElement('div');
    div.className = 'cline meta';
    div.textContent = 'Sunucu başlatıldığında loglar burada görünecek.';
    out.appendChild(div);
  }
  out.scrollTop = out.scrollHeight;
}

window.api.onServerLog(({ id, text }) => {
  if (id !== state.currentId) return;
  appendConsoleLines(text);
});

window.api.onServerStatus(({ id, status }) => {
  const dot = document.querySelector(`[data-dot="${id}"]`);
  if (dot) dot.className = 'status-dot ' + status;
  if (id === state.currentId) updateStatusUI(status);
  if (status === 'running') toast('Sunucu hazır! Oyundan bağlanabilirsin.');
});

window.api.onServerPlayers(({ id, online }) => {
  if (id !== state.currentId) return;
  renderOnlinePlayers(online, true);
  const chip = $('#inst-players-chip');
  chip.textContent = `${online.length} oyuncu`;
  chip.classList.toggle('hidden', online.length === 0);
});

async function sendCommand() {
  const input = $('#console-input');
  const cmd = input.value.trim();
  if (!cmd) return;
  try {
    await window.api.sendCommand({ id: state.currentId, command: cmd });
    state.cmdHistory.push(cmd);
    if (state.cmdHistory.length > 50) state.cmdHistory.shift();
    state.cmdHistoryIdx = -1;
    input.value = '';
  } catch (err) {
    toast(err.message, true);
  }
}

function handleConsoleKeys(e) {
  const input = $('#console-input');
  if (e.key === 'Enter') return sendCommand();
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!state.cmdHistory.length) return;
    if (state.cmdHistoryIdx === -1) state.cmdHistoryIdx = state.cmdHistory.length;
    state.cmdHistoryIdx = Math.max(0, state.cmdHistoryIdx - 1);
    input.value = state.cmdHistory[state.cmdHistoryIdx];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.cmdHistoryIdx === -1) return;
    state.cmdHistoryIdx++;
    if (state.cmdHistoryIdx >= state.cmdHistory.length) {
      state.cmdHistoryIdx = -1;
      input.value = '';
    } else {
      input.value = state.cmdHistory[state.cmdHistoryIdx];
    }
  }
}

/* ---------------- oyuncular sekmesi ---------------- */

function playerRow(name, buttons) {
  const row = document.createElement('div');
  row.className = 'player-row';
  row.innerHTML = `
    <img class="pr-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/26" />
    <div class="pr-name">${esc(name)}</div>`;
  bindImgFallback(row);
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || 'btn-ghost');
    btn.innerHTML = b.label;
    btn.title = b.title || '';
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  return row;
}

function emptyNote(container, text) {
  container.innerHTML = `<div class="empty-note">${esc(text)}</div>`;
}

function renderOnlinePlayers(online, running) {
  $('#online-count').textContent = online.length;
  const box = $('#online-players');
  box.innerHTML = '';
  if (!online.length) {
    emptyNote(box, running ? 'Şu an kimse yok. Arkadaşlarını davet et!' : 'Sunucu kapalı.');
    return;
  }
  for (const name of online) {
    box.appendChild(playerRow(name, [
      {
        label: 'At', title: 'Sunucudan at (kick)',
        onClick: async () => {
          await window.api.sendCommand({ id: state.currentId, command: `kick ${name}` }).catch((e) => toast(e.message, true));
          toast(`${name} sunucudan atıldı.`);
        }
      },
      {
        label: 'Yasakla', cls: 'btn-ghost danger-text', title: 'Kalıcı yasakla (ban)',
        onClick: async () => {
          if (!confirm(`${name} kalıcı olarak yasaklansın mı?`)) return;
          await window.api.sendCommand({ id: state.currentId, command: `ban ${name}` }).catch((e) => toast(e.message, true));
          toast(`${name} yasaklandı.`);
        }
      }
    ]));
  }
}

async function loadPlayersTab() {
  if (!state.currentId) return;
  let info;
  try {
    info = await window.api.getPlayersInfo({ id: state.currentId });
  } catch (_e) {
    return;
  }
  const status = await window.api.getServerStatus({ id: state.currentId });
  const running = status !== 'stopped';

  renderOnlinePlayers(info.online, running);
  const chip = $('#inst-players-chip');
  chip.textContent = `${info.online.length} oyuncu`;
  chip.classList.toggle('hidden', !running || info.online.length === 0);

  // beyaz liste
  $('#wl-toggle').checked = info.whitelistEnabled;
  $('#wl-hint').textContent = info.whitelistEnabled
    ? 'Açık: sadece listedekiler girebilir.'
    : 'Kapalı: herkes girebilir. Açmak için anahtarı kullan.';
  const wlBox = $('#wl-list');
  wlBox.innerHTML = '';
  if (!info.whitelist.length) emptyNote(wlBox, 'Liste boş.');
  for (const entry of info.whitelist) {
    wlBox.appendChild(playerRow(entry.name, [
      {
        label: ICONS.trash, cls: 'btn-icon btn-sm danger-text', title: 'Listeden çıkar',
        onClick: async () => {
          await window.api.whitelistRemove({ id: state.currentId, name: entry.name });
          loadPlayersTab();
        }
      }
    ]));
  }

  // op listesi
  const opBox = $('#op-list');
  opBox.innerHTML = '';
  if (!info.ops.length) emptyNote(opBox, 'Henüz yetkili yok.');
  for (const entry of info.ops) {
    opBox.appendChild(playerRow(entry.name, [
      {
        label: ICONS.trash, cls: 'btn-icon btn-sm danger-text', title: 'Yetkiyi al',
        onClick: async () => {
          await window.api.opRemove({ id: state.currentId, name: entry.name });
          loadPlayersTab();
        }
      }
    ]));
  }

  // kayıtlar
  const evBox = $('#player-events');
  evBox.innerHTML = '';
  if (!info.events.length) emptyNote(evBox, 'Henüz kayıt yok. Oyuncular girip çıktıkça burada görünür.');
  for (const ev of info.events) {
    const row = document.createElement('div');
    row.className = 'event-row ' + ev.action;
    row.innerHTML = `
      <span class="ev-badge"></span>
      <span class="ev-name">${esc(ev.name)}</span>
      <span>${ev.action === 'join' ? 'giriş yaptı' : 'çıktı'}</span>
      <span class="ev-time">${fmtTime(ev.at)}</span>`;
    evBox.appendChild(row);
  }
}

async function addWhitelist() {
  const input = $('#wl-input');
  const name = input.value.trim();
  if (!name) return;
  try {
    await window.api.whitelistAdd({ id: state.currentId, name });
    input.value = '';
    toast(`${name} beyaz listeye eklendi.`);
    loadPlayersTab();
  } catch (err) {
    toast(err.message, true);
  }
}

async function addOp() {
  const input = $('#op-input');
  const name = input.value.trim();
  if (!name) return;
  try {
    await window.api.opAdd({ id: state.currentId, name });
    input.value = '';
    toast(`${name} artık yetkili (OP).`);
    loadPlayersTab();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------------- bağlantı sekmesi ---------------- */

function addrRow(label, addr) {
  const row = document.createElement('div');
  row.className = 'addr-row';
  row.innerHTML = `
    <div style="flex:1">
      <div class="addr">${esc(addr)}</div>
      <div class="addr-label">${esc(label)}</div>
    </div>`;
  const btn = document.createElement('button');
  btn.className = 'btn btn-icon btn-sm';
  btn.innerHTML = ICONS.copy;
  btn.title = 'Kopyala';
  btn.addEventListener('click', () => copyText(addr));
  row.appendChild(btn);
  return row;
}

async function loadConnectionTab() {
  if (!state.currentId) return;
  let info;
  try {
    info = await window.api.getNetInfo({ id: state.currentId });
  } catch (_e) {
    return;
  }

  const lan = $('#lan-addresses');
  lan.innerHTML = '';
  if (!info.local.length) emptyNote(lan, 'Yerel ağ adresi bulunamadı.');
  for (const l of info.local) {
    lan.appendChild(addrRow(l.iface, `${l.ip}:${info.port}`));
  }

  const wan = $('#wan-address');
  wan.innerHTML = '';
  if (info.public) {
    wan.appendChild(addrRow('Genel (dış) IP adresin', `${info.public}:${info.port}`));
  } else {
    emptyNote(wan, 'Genel IP alınamadı (internet bağlantısını kontrol et).');
  }
  $('#pf-port').textContent = info.port;
}

/* ---------------- modlar sekmesi ---------------- */

async function loadModsTab() {
  const mods = await window.api.listMods({ id: state.currentId });
  $('#mods-count').textContent = mods.length ? `${mods.length} mod` : 'Henüz mod yok';
  const list = $('#mods-list');
  list.innerHTML = '';
  for (const mod of mods) {
    const row = document.createElement('div');
    row.className = 'mod-row' + (mod.enabled ? '' : ' disabled');
    row.innerHTML = `
      <div class="mr-name">${esc(mod.fileName.replace('.disabled', ''))}</div>
      <div class="mr-size">${mod.sizeMb} MB</div>
      <button class="btn btn-ghost" data-act="toggle">${mod.enabled ? 'Devre dışı bırak' : 'Etkinleştir'}</button>
      <button class="btn btn-ghost danger-text" data-act="delete">Sil</button>`;
    row.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
      await window.api.toggleMod({ id: state.currentId, fileName: mod.fileName });
      loadModsTab();
    });
    row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!confirm(`"${mod.fileName}" silinsin mi?`)) return;
      await window.api.deleteMod({ id: state.currentId, fileName: mod.fileName });
      loadModsTab();
    });
    list.appendChild(row);
  }
}

function switchModSource(source) {
  state.modSource = source;
  $$('#mod-source-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.source === source));
  $('#mod-search-results').innerHTML = '';
}

async function openModModal() {
  let filterLabel = 'Filtre: sunucu sürümü okunamadı — tüm modlar';
  try {
    const inst = await window.api.getInstance({ id: state.currentId });
    const loader = String(inst.loader || '').toLowerCase() || '?';
    filterLabel = `Filtre: MC ${inst.mcVersion || '?'} + ${loader} (uygun dosya yoksa genişletilir)`;
  } catch (_e) { /* yarı kurulum */ }
  $('#mod-filter-info').textContent = filterLabel;
  $('#mod-search-results').innerHTML = '';
  $('#modal-mod').classList.remove('hidden');
  const input = $('#mod-search-input');
  // select() bazı Electron sürümlerinde yazmayı bozuyor — sadece focus
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
  });
}

async function doModSearch() {
  const query = $('#mod-search-input').value.trim();
  const results = $('#mod-search-results');
  if (!query) {
    results.innerHTML = '<p class="muted">Aramak için bir şey yaz (örn. JEI).</p>';
    $('#mod-search-input').focus();
    return;
  }
  results.innerHTML = '<p class="muted">Aranıyor...</p>';
  let loader = null;
  let mcVersion = null;
  try {
    const inst = await window.api.getInstance({ id: state.currentId });
    loader = inst.loader || null;
    mcVersion = inst.mcVersion || null;
  } catch (_e) { /* filtre olmadan ara */ }
  try {
    const mods = await window.api.searchMods({
      source: state.modSource,
      query,
      loader,
      mcVersion
    });
    if (!mods.length) {
      results.innerHTML = '<p class="muted">Sonuç yok. Diğer kaynağı (Modrinth / CurseForge) dene.</p>';
      return;
    }
    results.innerHTML = '';
    for (const mod of mods) {
      const row = document.createElement('div');
      row.className = 'mod-result';
      row.innerHTML = `
        <img src="${esc(mod.icon || '')}" />
        <div class="mres-text">
          <div class="mres-name">${esc(mod.name)}</div>
          <div class="mres-desc">${esc(mod.description)}</div>
        </div>
        <button class="btn btn-primary" type="button">Ekle</button>`;
      bindImgFallback(row);
      row.querySelector('button').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'İndiriliyor...';
        try {
          const versions = await window.api.getModVersions({
            source: mod.source,
            projectId: mod.id,
            loader,
            mcVersion
          });
          if (!versions.length) throw new Error('Bu MC sürümü/loader için uygun dosya yok.');
          const v = versions[0];
          await window.api.installMod({
            instanceId: state.currentId,
            source: mod.source,
            projectId: mod.id,
            versionId: v.id,
            fileName: v.fileName,
            fileUrl: v.fileUrl
          });
          btn.textContent = 'Eklendi ✓';
          toast(`${mod.name} eklendi.`);
          loadModsTab();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Ekle';
          toast(`${mod.name} eklenemedi: ${errMsg(err)}`, true);
        }
      });
      results.appendChild(row);
    }
  } catch (err) {
    results.innerHTML = `<p class="muted">Arama hatası: ${esc(errMsg(err))}</p>`;
  }
}

/* ---------------- ayarlar sekmesi ---------------- */

async function loadSettingsTab(inst) {
  $('#set-memory').value = inst.memoryMb || 4096;
  $('#set-java').value = inst.javaPath || '';
  $('#set-eula').checked = !!inst.eulaAccepted;

  window.api.listJava().then((javas) => {
    const el = $('#java-versions');
    if (!javas.length) {
      el.textContent = 'Sistemde Java bulunamadı (kurulumda otomatik indirilir).';
      return;
    }
    el.innerHTML = 'Bulunan Java sürümleri (tıkla, seç):<br>' + javas
      .map((j) => `<a href="#" data-java="${esc(j.path)}">Java ${j.major} — ${esc(j.path)}</a>`)
      .join('<br>');
    el.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        $('#set-java').value = a.dataset.java;
      });
    });
  });

  const props = await window.api.getProperties({ id: inst.id });
  $('#prop-port').value = props['server-port'] || '';
  $('#prop-motd').value = props.motd || '';
  $('#prop-max').value = props['max-players'] || '';
  $('#prop-difficulty').value = props.difficulty || '';
  $('#prop-gamemode').value = props.gamemode || '';
  $('#prop-spawnprot').value = props['spawn-protection'] || '';
  $('#prop-idle').value = props['player-idle-timeout'] || '';

  // görüş & chunk stepper'ları
  setStepper('view', Number(props['view-distance']) || 10);
  setStepper('sim', Number(props['simulation-distance']) || 10);
  $('#prop-online').checked = props['online-mode'] !== 'false';
  $('#prop-pvp').checked = props.pvp !== 'false';

  // dünya ayarları (değer yoksa Minecraft varsayılanları)
  $('#world-seed').value = props['level-seed'] || '';
  const lt = (props['level-type'] || '').toLowerCase().replace('\\', '');
  $('#world-type').value =
    lt.includes('flat') ? 'minecraft:flat' :
    lt.includes('large') ? 'minecraft:large_biomes' :
    lt.includes('amplified') ? 'minecraft:amplified' :
    lt ? 'minecraft:normal' : '';
  $('#world-structures').checked = props['generate-structures'] !== 'false';
  $('#world-hardcore').checked = props.hardcore === 'true';
  $('#world-animals').checked = props['spawn-animals'] !== 'false';
  $('#world-monsters').checked = props['spawn-monsters'] !== 'false';
  $('#world-npcs').checked = props['spawn-npcs'] !== 'false';
  $('#world-nether').checked = props['allow-nether'] !== 'false';
  $('#world-flight').checked = props['allow-flight'] === 'true';
  $('#world-cmdblock').checked = props['enable-command-block'] === 'true';
  $('#world-forcegm').checked = props['force-gamemode'] === 'true';
}

/* ---------------- görüş / chunk stepper ---------------- */

function clampChunk(n) {
  return Math.max(3, Math.min(32, n));
}

function getStepper(kind) {
  return clampChunk(Number($(`#step-${kind}`).textContent) || 10);
}

function setStepper(kind, value) {
  $(`#step-${kind}`).textContent = clampChunk(value);
}

function bumpStepper(kind, dir) {
  setStepper(kind, getStepper(kind) + dir);
}

async function saveChunks() {
  try {
    await window.api.setProperties({
      id: state.currentId,
      updates: {
        'view-distance': String(getStepper('view')),
        'simulation-distance': String(getStepper('sim'))
      }
    });
    toast(`Görüş ${getStepper('view')} / simülasyon ${getStepper('sim')} kaydedildi. Yeniden başlatınca uygulanır.`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveWorldSettings() {
  const updates = {
    'generate-structures': $('#world-structures').checked ? 'true' : 'false',
    hardcore: $('#world-hardcore').checked ? 'true' : 'false',
    'spawn-animals': $('#world-animals').checked ? 'true' : 'false',
    'spawn-monsters': $('#world-monsters').checked ? 'true' : 'false',
    'spawn-npcs': $('#world-npcs').checked ? 'true' : 'false',
    'allow-nether': $('#world-nether').checked ? 'true' : 'false',
    'allow-flight': $('#world-flight').checked ? 'true' : 'false',
    'enable-command-block': $('#world-cmdblock').checked ? 'true' : 'false',
    'force-gamemode': $('#world-forcegm').checked ? 'true' : 'false'
  };
  const seed = $('#world-seed').value.trim();
  const type = $('#world-type').value;
  if (seed) updates['level-seed'] = seed;
  if (type) updates['level-type'] = type;
  try {
    await window.api.setProperties({ id: state.currentId, updates });
    toast('Dünya ayarları kaydedildi. Yeniden başlatınca uygulanır.');
  } catch (err) {
    toast(err.message, true);
  }
}

async function resetWorld() {
  const ok = confirm(
    'DÜNYA KALICI OLARAK SİLİNECEK!\n\n' +
    'Tüm yapılar, eşyalar ve ilerleme kaybolur. Sunucu bir sonraki açılışta ' +
    'yeni seed/dünya tipi ayarlarıyla sıfırdan dünya oluşturur.\n\nEmin misin?'
  );
  if (!ok) return;
  try {
    await window.api.resetWorld({ id: state.currentId });
    toast('Dünya silindi. Sunucuyu başlattığında yeni dünya oluşacak.');
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveInstanceSettings() {
  try {
    await window.api.updateInstance({
      id: state.currentId,
      updates: {
        memoryMb: Number($('#set-memory').value) || 4096,
        javaPath: $('#set-java').value.trim(),
        eulaAccepted: $('#set-eula').checked
      }
    });
    toast('Kaydedildi.');
    openInstance(state.currentId);
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveProps() {
  const updates = {
    'online-mode': $('#prop-online').checked ? 'true' : 'false',
    pvp: $('#prop-pvp').checked ? 'true' : 'false'
  };
  const fields = {
    'server-port': $('#prop-port').value.trim(),
    motd: $('#prop-motd').value.trim(),
    'max-players': $('#prop-max').value.trim(),
    difficulty: $('#prop-difficulty').value,
    gamemode: $('#prop-gamemode').value,
    'spawn-protection': $('#prop-spawnprot').value.trim(),
    'player-idle-timeout': $('#prop-idle').value.trim()
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v) updates[k] = v;
  }
  try {
    await window.api.setProperties({ id: state.currentId, updates });
    toast('server.properties kaydedildi. Yeniden başlatınca uygulanır.');
    loadConnectionTab();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------------- uygulama ayarları ---------------- */

async function openAppSettings() {
  const s = await window.api.getSettings();
  $('#as-memory').value = s.defaultMemoryMb;
  $('#as-cfkey').value = s.curseforgeApiKey || '';
  $('#modal-settings').classList.remove('hidden');
}

/* ---------------- olay bağlama ---------------- */

function bind() {
  $('#inst-icon').addEventListener('error', () => { $('#inst-icon').style.visibility = 'hidden'; });
  $('#btn-new-server').addEventListener('click', () => showView('create'));
  document.querySelector('[data-action="new-server"]').addEventListener('click', () => showView('create'));

  $$('#source-tabs .tab').forEach((t) =>
    t.addEventListener('click', () => switchCreateSource(t.dataset.source)));
  $('#pack-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    doSearch();
  });
  $('#search-input').addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.currentTarget.focus();
  });
  $('#btn-import-file').addEventListener('click', importFromFile);
  $('#btn-vanilla-install').addEventListener('click', startVanillaInstall);
  $('#vanilla-version').addEventListener('change', () => {
    const v = $('#vanilla-version').value;
    if (v) $('#vanilla-name').value = `Vanilla ${v}`;
  });

  $('#mv-cancel').addEventListener('click', () => $('#modal-version').classList.add('hidden'));
  $('#mv-install').addEventListener('click', startInstall);

  $$('#inst-tabs .tab').forEach((t) =>
    t.addEventListener('click', () => switchInstanceTab(t.dataset.tab)));

  $('#btn-start').addEventListener('click', async () => {
    try {
      await window.api.startServer({ id: state.currentId });
    } catch (err) {
      toast(errMsg(err), true);
    }
  });
  $('#btn-stop').addEventListener('click', () => window.api.stopServer({ id: state.currentId }));
  $('#btn-open-folder').addEventListener('click', () => window.api.openInstanceFolder({ id: state.currentId }));
  $('#btn-delete').addEventListener('click', async () => {
    const inst = state.instances.find((i) => i.id === state.currentId);
    if (!confirm(`"${inst ? inst.name : ''}" sunucusu ve TÜM dünya verileri silinecek. Emin misin?`)) return;
    await window.api.deleteInstance({ id: state.currentId });
    state.currentId = null;
    await refreshInstances();
    showView(state.instances.length ? 'create' : 'welcome');
  });

  $('#btn-send-cmd').addEventListener('click', sendCommand);
  $('#console-input').addEventListener('keydown', handleConsoleKeys);

  // oyuncular
  $('#wl-add').addEventListener('click', addWhitelist);
  $('#wl-input').addEventListener('keydown', (e) => e.key === 'Enter' && addWhitelist());
  $('#op-add').addEventListener('click', addOp);
  $('#op-input').addEventListener('keydown', (e) => e.key === 'Enter' && addOp());
  $('#wl-toggle').addEventListener('change', async (e) => {
    try {
      await window.api.whitelistToggle({ id: state.currentId, enabled: e.target.checked });
      toast(e.target.checked ? 'Beyaz liste açıldı.' : 'Beyaz liste kapatıldı.');
      loadPlayersTab();
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#events-refresh').addEventListener('click', loadPlayersTab);

  // bağlantı
  $('#net-refresh').addEventListener('click', loadConnectionTab);

  // modlar
  $('#btn-add-mod').addEventListener('click', openModModal);
  $('#btn-add-mod-file').addEventListener('click', async () => {
    const added = await window.api.addModFromFile({ id: state.currentId });
    if (added.length) {
      toast(`${added.length} mod eklendi.`);
      loadModsTab();
    }
  });
  $$('#mod-source-tabs .tab').forEach((t) =>
    t.addEventListener('click', () => switchModSource(t.dataset.source)));
  $('#mod-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    doModSearch();
  });
  $('#mod-search-input').addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.currentTarget.focus();
  });
  $('#mod-close').addEventListener('click', () => $('#modal-mod').classList.add('hidden'));
  // Backdrop tıklanınca kapat; modal içeriğine tıklanınca kapanmasın
  $('#modal-mod').addEventListener('mousedown', (e) => {
    if (e.target === $('#modal-mod')) $('#modal-mod').classList.add('hidden');
  });
  $('#modal-mod .modal').addEventListener('mousedown', (e) => e.stopPropagation());

  // ayarlar
  $('#btn-save-instance').addEventListener('click', saveInstanceSettings);
  $('#btn-save-props').addEventListener('click', saveProps);
  $('#btn-save-world').addEventListener('click', saveWorldSettings);
  $('#btn-reset-world').addEventListener('click', resetWorld);
  $('#btn-save-chunks').addEventListener('click', saveChunks);
  $$('.step-btn').forEach((b) =>
    b.addEventListener('click', () => bumpStepper(b.dataset.step, Number(b.dataset.dir))));
  $$('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      const [v, s] = b.dataset.preset.split(',').map(Number);
      setStepper('view', v);
      setStepper('sim', s);
    }));

  $('#btn-settings').addEventListener('click', openAppSettings);
  $('#as-cancel').addEventListener('click', () => $('#modal-settings').classList.add('hidden'));
  $('#as-save').addEventListener('click', async () => {
    await window.api.setSettings({
      defaultMemoryMb: Number($('#as-memory').value) || 4096,
      curseforgeApiKey: $('#as-cfkey').value.trim()
    });
    $('#modal-settings').classList.add('hidden');
    toast('Ayarlar kaydedildi.');
  });
}

/* ---------------- başlangıç ---------------- */

async function init() {
  bind();
  await refreshInstances();
  showView(state.instances.length ? 'create' : 'welcome');
  if (state.instances.length) {
    openInstance(state.instances[0].id);
  }
}

init();
