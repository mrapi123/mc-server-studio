# Degisiklikleri push'lar, v1.0.0 release olusturur ve exe'leri yukler. Token goruntulenmez.
$ErrorActionPreference = "Stop"

$credOutput = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($credOutput | Select-String '^password=(.*)$').Matches[0].Groups[1].Value
if (-not $token) { Write-Error "GitHub kimlik bilgisi bulunamadi"; exit 1 }
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "mc-server-studio-publish" }

$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$login = $user.login
$email = "$($user.id)+$login@users.noreply.github.com"
$repo = "$login/mc-server-studio"

# 1) Commit + push
git add -A
git -c user.name="$login" -c user.email="$email" commit -m "Dunya ayarlari (Aternos tarzi), oyuncu yonetimi ve yeni arayuz"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit edilecek degisiklik yok, devam..." }
git push origin main

# 2) Release olustur
$relBody = @"
Modrinth ve CurseForge modpack destekli Minecraft sunucu yoneticisi.

**Kurulum:** MC Server Studio 1.0.0.exe (tasinabilir, kurulum gerektirmez) veya Setup exe'sini indir.
Windows SmartScreen uyarisinda "Ek bilgi > Yine de calistir" secin (uygulama imzasizdir).

**Ozellikler:** modpack arama/kurulum, Forge/NeoForge/Fabric/Quilt, otomatik Java, mod ekleme,
konsol, oyuncu yonetimi (whitelist/OP/kayitlar), dunya ayarlari, baglanti (IP) sekmesi.
"@

try {
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body (@{
    tag_name = "v1.0.0"
    name = "MC Server Studio v1.0.0"
    body = $relBody
    draft = $false
    prerelease = $false
  } | ConvertTo-Json) -ContentType "application/json"
  Write-Output "Release olusturuldu: $($rel.html_url)"
} catch {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/v1.0.0" -Headers $headers
  Write-Output "Release zaten var: $($rel.html_url)"
}

# 3) Exe'leri yukle
$assets = @(
  @{ path = "dist\MC Server Studio 1.0.0.exe";       name = "MC.Server.Studio.1.0.0.portable.exe" },
  @{ path = "dist\MC Server Studio Setup 1.0.0.exe"; name = "MC.Server.Studio.Setup.1.0.0.exe" }
)
foreach ($a in $assets) {
  $existing = $rel.assets | Where-Object { $_.name -eq $a.name }
  if ($existing) { Write-Output "$($a.name) zaten yuklu, atlaniyor"; continue }
  Write-Output "Yukleniyor: $($a.name) ..."
  $uploadUrl = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$($a.name)"
  Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $a.path -ContentType "application/octet-stream" | Out-Null
  Write-Output "Yuklendi: $($a.name)"
}

Write-Output "TAMAM: https://github.com/$repo/releases/tag/v1.0.0"
