# Push + v1.2.1 release
$ErrorActionPreference = "Stop"
$credOutput = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($credOutput | Select-String '^password=(.*)$').Matches[0].Groups[1].Value
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "mc-server-studio-publish" }
$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$login = $user.login
$email = "$($user.id)+$login@users.noreply.github.com"
$repo = "$login/mc-server-studio"
$tag = "v1.2.1"

git add -A
git -c user.name="$login" -c user.email="$email" commit -m "v1.2.1: modpack resource pack otomatik indirme ve sunucuya yayma"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit yok, devam..." }
git push origin main

$body = @{
  tag_name = $tag
  name = "MC Server Studio v1.2.1"
  body = @"
## Indirme
- MC.Server.Studio.1.2.1.portable.exe
- MC.Server.Studio.Setup.1.2.1.exe

## v1.2.1
- Modpack kurulurken resource pack'ler otomatik indirilir (Modrinth + CurseForge)
- Sunucu acilinca resource pack yerel HTTP ile oyunculara gonderilir
- server.properties resource-pack / sha1 otomatik ayarlanir
"@
  draft = $false
  prerelease = $false
} | ConvertTo-Json

$rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body $body -ContentType "application/json"
Write-Output "Release: $($rel.html_url)"

foreach ($a in @(
  @{ path = "dist\MC Server Studio 1.2.1.exe"; name = "MC.Server.Studio.1.2.1.portable.exe" },
  @{ path = "dist\MC Server Studio Setup 1.2.1.exe"; name = "MC.Server.Studio.Setup.1.2.1.exe" }
)) {
  Write-Output "Upload $($a.name)"
  $url = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$($a.name)"
  Invoke-RestMethod -Method Post -Uri $url -Headers $headers -InFile $a.path -ContentType "application/octet-stream" | Out-Null
}
Write-Output "TAMAM: https://github.com/$repo/releases/tag/$tag"
