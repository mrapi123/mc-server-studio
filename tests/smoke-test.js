/* Ağ API'lerinin çalıştığını doğrulayan hızlı test. Çalıştırma: npm run test:smoke */

async function main() {
  const results = [];

  // Modrinth modpack arama
  try {
    const facets = encodeURIComponent(JSON.stringify([['project_type:modpack']]));
    const r = await fetch(`https://api.modrinth.com/v2/search?query=soulrend&facets=${facets}&limit=3`);
    const j = await r.json();
    results.push(['Modrinth arama', r.status, j.hits.map((h) => h.title).join(' | ')]);
  } catch (e) {
    results.push(['Modrinth arama', 'HATA', e.message]);
  }

  // CurseForge proxy arama
  try {
    const r = await fetch('https://api.curse.tools/v1/cf/mods/search?gameId=432&classId=4471&searchFilter=soulrend&pageSize=3&sortField=2&sortOrder=desc');
    const j = await r.json();
    results.push(['CurseForge (curse.tools) arama', r.status, j.data.map((m) => `${m.name} (id:${m.id})`).join(' | ')]);
  } catch (e) {
    results.push(['CurseForge arama', 'HATA', e.message]);
  }

  // Fabric meta
  try {
    const r = await fetch('https://meta.fabricmc.net/v2/versions/installer');
    const j = await r.json();
    results.push(['Fabric meta', r.status, 'installer ' + j[0].version]);
  } catch (e) {
    results.push(['Fabric meta', 'HATA', e.message]);
  }

  // Adoptium
  try {
    const r = await fetch('https://api.adoptium.net/v3/assets/latest/21/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse');
    const j = await r.json();
    results.push(['Adoptium Java 21', r.status, j[0].binary.package.name]);
  } catch (e) {
    results.push(['Adoptium', 'HATA', e.message]);
  }

  for (const [name, status, detail] of results) {
    console.log(`${name}: ${status} -> ${detail}`);
  }
}

main();
