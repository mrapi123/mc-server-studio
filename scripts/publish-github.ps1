# GitHub'da public repo olusturup kodu gonderir. Token hicbir yerde goruntulenmez.
$ErrorActionPreference = "Stop"

# 1) Kimlik bilgisini bellek ici al (yazdirma!)
$credOutput = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($credOutput | Select-String '^password=(.*)$').Matches[0].Groups[1].Value
if (-not $token) { Write-Error "GitHub kimlik bilgisi bulunamadi"; exit 1 }
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "mc-server-studio-publish" }

# 2) Kullanici bilgisi
$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$login = $user.login
$email = "$($user.id)+$login@users.noreply.github.com"
Write-Output "Kullanici: $login"

# 3) Repo olustur (varsa hata verme)
try {
  $repo = Invoke-RestMethod -Method Post -Uri "https://api.github.com/user/repos" -Headers $headers -Body (@{
    name = "mc-server-studio"
    description = "Modrinth ve CurseForge modpack destekli Minecraft sunucu yoneticisi (Electron)"
    private = $false
  } | ConvertTo-Json) -ContentType "application/json"
  Write-Output "Repo olusturuldu: $($repo.html_url)"
} catch {
  Write-Output "Repo zaten var olabilir, devam ediliyor..."
}

# 4) Commit (kimlik sadece bu komutlara ozel, git config degistirilmez)
git add -A
git -c user.name="$login" -c user.email="$email" commit -m "MC Server Studio: Modrinth/CurseForge modpack destekli Minecraft sunucu yoneticisi"
if ($LASTEXITCODE -ne 0) { Write-Output "Commit zaten yapilmis olabilir, devam..." }

# 5) Push
git branch -M main
$remotes = git remote
if ($remotes -notcontains "origin") {
  git remote add origin "https://github.com/$login/mc-server-studio.git"
}
git push -u origin main
Write-Output "TAMAM: https://github.com/$login/mc-server-studio"
