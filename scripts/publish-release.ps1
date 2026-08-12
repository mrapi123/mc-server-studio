# Degisiklikleri push'lar, v1.1.0 release olusturur ve exe'leri yukler. Token goruntulenmez.
# Calistirma (repo kokunden): powershell -ExecutionPolicy Bypass -File scripts/publish-release.ps1
$ErrorActionPreference = "Stop"

$credOutput = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($credOutput | Select-String '^password=(.*)$').Matches[0].Groups[1].Value
if (-not $token) { Write-Error "GitHub kimlik bilgisi bulunamadi"; exit 1 }
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "mc-server-studio-publish" }

$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$login = $user.login
$email = "$($user.id)+$login@users.noreply.github.com"
$repo = "$login/mc-server-studio"
$tag = "v1.1.0"
$portable = "dist\MC Server Studio 1.1.0.exe"
$setup = "dist\MC Server Studio Setup 1.1.0.exe"

# 1) Commit + push
git add -A
git -c user.name="$login" -c user.email="$email" commit -m "v1.1.0: gorus/chunk stepper, dunya ayarlari, duzenli repo yapisi"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit edilecek degisiklik yok, devam..." }
git push origin main

# 2) Release olustur
$relBody = @"
## Indirme

- **MC.Server.Studio.1.1.0.portable.exe** — kurulum yok, cift tikla calisir
- **MC.Server.Studio.Setup.1.1.0.exe** — kurulum sihirbazi

Windows SmartScreen uyarisinda **Ek bilgi > Yine de calistir** secin (uygulama imzasizdir).

## v1.1.0 yenilikleri

- **Gorus mesafesi** ve **chunk simulasyon mesafesi** icin +/- butonlari (3–32)
- Hazir profiller: Potato, Dengeli, Varsayilan, Yuksek, Ultra
- Aternos tarzi dunya ayarlari (seed, dunya tipi, hardcore, spawn, Nether, ucus, komut blogu, dunya sifirlama)
- Oyuncu yonetimi: whitelist, OP, cevrimici liste, giris/cikis kayitlari
- Baglanti sekmesi: LAN + genel IP
- Repo duzeni: ``src/``, ``renderer/``, ``tests/``, ``scripts/``
"@

try {
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body (@{
    tag_name = $tag
    name = "MC Server Studio v1.1.0"
    body = $relBody
    draft = $false
    prerelease = $false
  } | ConvertTo-Json) -ContentType "application/json"
  Write-Output "Release olusturuldu: $($rel.html_url)"
} catch {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers
  Write-Output "Release zaten var: $($rel.html_url)"
}

# 3) Exe'leri yukle
$assets = @(
  @{ path = $portable; name = "MC.Server.Studio.1.1.0.portable.exe" },
  @{ path = $setup;     name = "MC.Server.Studio.Setup.1.1.0.exe" }
)
foreach ($a in $assets) {
  if (-not (Test-Path $a.path)) { Write-Error "Dosya yok: $($a.path)"; continue }
  $existing = $rel.assets | Where-Object { $_.name -eq $a.name }
  if ($existing) { Write-Output "$($a.name) zaten yuklu, atlaniyor"; continue }
  Write-Output "Yukleniyor: $($a.name) ..."
  $uploadUrl = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$($a.name)"
  Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $a.path -ContentType "application/octet-stream" | Out-Null
  Write-Output "Yuklendi: $($a.name)"
}

Write-Output "TAMAM: https://github.com/$repo/releases/tag/$tag"
