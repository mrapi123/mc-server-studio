# Degisiklikleri push'lar, v1.2.0 release olusturur ve exe'leri yukler.
$ErrorActionPreference = "Stop"
$credOutput = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($credOutput | Select-String '^password=(.*)$').Matches[0].Groups[1].Value
if (-not $token) { Write-Error "GitHub kimlik bilgisi bulunamadi"; exit 1 }
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "mc-server-studio-publish" }

$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$login = $user.login
$email = "$($user.id)+$login@users.noreply.github.com"
$repo = "$login/mc-server-studio"
$tag = "v1.2.0"
$portable = "dist\MC Server Studio 1.2.0.exe"
$setup = "dist\MC Server Studio Setup 1.2.0.exe"

git add -A
git -c user.name="$login" -c user.email="$email" commit -m "v1.2.0: vanilla sunucu, indirme resume, lag uyarisi, mod arama ve jar bulma duzeltmeleri"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit yok, devam..." }
git push origin main

$relBody = @"
## Indirme
- **MC.Server.Studio.1.2.0.portable.exe** — kurulum yok
- **MC.Server.Studio.Setup.1.2.0.exe** — kurulum sihirbazi

Windows SmartScreen: Ek bilgi > Yine de calistir

## v1.2.0
- Vanilla (modsuz) sunucu kurulumu
- Buyuk modpack indirmelerinde timeout kaldirildi + kaldigi yerden devam
- Can't keep up lag uyarisi (toast + oneri)
- Mod arama kutusu duzeltildi
- Eksik jar / yarim kurulum hatalari iyilestirildi
- Daha genis Forge/NeoForge/Fabric baslatma tespiti
"@

try {
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body (@{
    tag_name = $tag
    name = "MC Server Studio v1.2.0"
    body = $relBody
    draft = $false
    prerelease = $false
  } | ConvertTo-Json) -ContentType "application/json"
  Write-Output "Release: $($rel.html_url)"
} catch {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers
  Write-Output "Release zaten var: $($rel.html_url)"
}

$assets = @(
  @{ path = $portable; name = "MC.Server.Studio.1.2.0.portable.exe" },
  @{ path = $setup;     name = "MC.Server.Studio.Setup.1.2.0.exe" }
)
foreach ($a in $assets) {
  if (-not (Test-Path $a.path)) { Write-Error "Dosya yok: $($a.path)"; continue }
  $existing = $rel.assets | Where-Object { $_.name -eq $a.name }
  if ($existing) {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($existing.id)" -Headers $headers
  }
  Write-Output "Yukleniyor: $($a.name)"
  $uploadUrl = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$($a.name)"
  Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $a.path -ContentType "application/octet-stream" | Out-Null
}
Write-Output "TAMAM: https://github.com/$repo/releases/tag/$tag"
