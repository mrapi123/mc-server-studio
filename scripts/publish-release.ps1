$ErrorActionPreference = "Stop"
$credOutput = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($credOutput | Select-String '^password=(.*)$').Matches[0].Groups[1].Value
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "mc-server-studio-publish" }
$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$login = $user.login
$email = "$($user.id)+$login@users.noreply.github.com"
$repo = "$login/mc-server-studio"
$tag = "v1.2.9"

git add -A
git -c user.name="$login" -c user.email="$email" commit -m "v1.2.9: istemci modlarini silme - tam senkron (watut/wakes)"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit yok" }
git push origin main

$rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body (@{
  tag_name = $tag
  name = "MC Server Studio v1.2.9"
  body = @"
## Degisiklik
- Istemci pack'teki modlar artik **silinmiyor** (watut, wakes vb. kanal uyumsuzlugu giderildi)
- Otomatik purge kapatildi — sunucu istemciyle ayni mod listesine yaklasir
- Yalnizca sunucuyu kesin dusturen birkaçı atlanir (stop_rendering, audioimprovements, sodium/oculus/colorwheel, subtle_effects, particle_core)

## Not
Mevcut Better MC'ye eksik jar'lar geri kondu; sunucuyu yeniden baslatip baglan.
"@
  draft = $false
  prerelease = $false
} | ConvertTo-Json) -ContentType "application/json"

foreach ($a in @(
  @{ path = "dist\MC Server Studio 1.2.9.exe"; name = "MC.Server.Studio.1.2.9.portable.exe" },
  @{ path = "dist\MC Server Studio Setup 1.2.9.exe"; name = "MC.Server.Studio.Setup.1.2.9.exe" }
)) {
  $url = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$($a.name)"
  Invoke-RestMethod -Method Post -Uri $url -Headers $headers -InFile $a.path -ContentType "application/octet-stream" | Out-Null
}
Write-Output "OK https://github.com/$repo/releases/tag/$tag"
