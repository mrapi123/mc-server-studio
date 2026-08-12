# v1.1.0: push + release + exe upload. Token goruntulenmez.
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

git add -A
git -c user.name="$login" -c user.email="$email" commit -m "v1.1.0: gorus/chunk stepper, dunya ayarlari, duzenli repo yapisi"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit yok veya atlandi, devam..." }
git push origin main

$relBody = @"
## Yenilikler
- **Görüş & Chunk Performansı**: view-distance ve simulation-distance için +/- stepper ve hazır profiller (Potato → Ultra)
- Aternos tarzı dünya ayarları (seed, tip, hardcore, spawn, nether, uçuş, komut bloğu, dünya sıfırlama)
- Repo düzeni: ``tests/``, ``scripts/``, güncel README

## İndir
- **portable** — kurulum gerektirmez
- **Setup** — kurulum sihirbazı

Windows SmartScreen uyarısında: Ek bilgi → Yine de çalıştır.
"@

try {
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body (@{
    tag_name = $tag
    name = "MC Server Studio $tag"
    body = $relBody
    draft = $false
    prerelease = $false
  } | ConvertTo-Json) -ContentType "application/json"
  Write-Output "Release olusturuldu: $($rel.html_url)"
} catch {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers
  Write-Output "Release zaten var: $($rel.html_url)"
}

$assets = @(
  @{ path = "dist\MC Server Studio 1.1.0.exe";       name = "MC.Server.Studio.1.1.0.portable.exe" },
  @{ path = "dist\MC Server Studio Setup 1.1.0.exe"; name = "MC.Server.Studio.Setup.1.1.0.exe" }
)
foreach ($a in $assets) {
  if (-not (Test-Path $a.path)) { Write-Error "Dosya yok: $($a.path)"; continue }
  $existing = $rel.assets | Where-Object { $_.name -eq $a.name }
  if ($existing) {
    Invoke-RestMethod -Method Delete -Uri $existing.url -Headers $headers | Out-Null
  }
  Write-Output "Yukleniyor: $($a.name) ..."
  $uploadUrl = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$($a.name)"
  Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $a.path -ContentType "application/octet-stream" | Out-Null
  Write-Output "Yuklendi: $($a.name)"
}

Write-Output "TAMAM: https://github.com/$repo/releases/tag/$tag"
