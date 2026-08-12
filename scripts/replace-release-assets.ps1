# v1.1.0 asset'lerini silip guncel exe'leri yeniden yukler. Token goruntulenmez.
$ErrorActionPreference = "Stop"
$credOutput = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($credOutput | Select-String '^password=(.*)$').Matches[0].Groups[1].Value
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "mc-server-studio-publish" }
$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$login = $user.login
$email = "$($user.id)+$login@users.noreply.github.com"
$repo = "$login/mc-server-studio"

git add -A
git -c user.name="$login" -c user.email="$email" commit -m "Kaydet butonu syntax duzeltmesi"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit yok, devam..." }
git push origin main

$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/v1.1.0" -Headers $headers
foreach ($a in $rel.assets) {
  Write-Output "Siliniyor: $($a.name)"
  Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($a.id)" -Headers $headers
}

$assets = @(
  @{ path = "dist\MC Server Studio 1.1.0.exe";       name = "MC.Server.Studio.1.1.0.portable.exe" },
  @{ path = "dist\MC Server Studio Setup 1.1.0.exe"; name = "MC.Server.Studio.Setup.1.1.0.exe" }
)
foreach ($a in $assets) {
  Write-Output "Yukleniyor: $($a.name) ..."
  $uploadUrl = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$($a.name)"
  Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $a.path -ContentType "application/octet-stream" | Out-Null
  Write-Output "Yuklendi: $($a.name)"
}
Write-Output "TAMAM: https://github.com/$repo/releases/tag/v1.1.0"
