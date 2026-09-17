# Corrige "Chave de licenca invalida" apos ativar no painel.
# Comenta LICENSE_KEY no .env e reinicia api/worker.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "docker-windows.ps1")

Write-Host "==> Uber Automation - corrigir licenca (Windows)"
Write-Host "    Pasta: $Root"
Write-Host ""

Ensure-DockerReady

if (-not (Test-Path "storage")) {
  New-Item -ItemType Directory -Path "storage" | Out-Null
}

if (Test-Path ".env") {
  $envText = Get-Content ".env" -Raw
  if ($envText -match '(?m)^[ \t]*LICENSE_KEY=') {
    $bak = ".env.bak-license-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item ".env" $bak
    $envText = [regex]::Replace($envText, '(?m)^([ \t]*LICENSE_KEY=)', '# $1')
    Set-Content -Path ".env" -Value $envText -NoNewline
    Write-Host "==> LICENSE_KEY comentada no .env (backup: $bak)"
  } else {
    Write-Host "==> .env sem LICENSE_KEY ativa (OK)"
  }
  if ($envText -notmatch '(?m)^[ \t]*LICENSE_SERVER_URL=') {
    Add-Content -Path ".env" -Value "`nLICENSE_SERVER_URL=https://automacao.gdapps.online"
    Write-Host "==> LICENSE_SERVER_URL adicionado"
  }
} else {
  Write-Host "AVISO: .env nao encontrado — rode INSTALAR primeiro"
}

Write-Host "==> storage/license.key:"
if (Test-Path "storage\license.key") {
  $key = (Get-Content "storage\license.key" -Raw).Trim()
  if ($key.Length -ge 8) {
    Write-Host "    presente: $($key.Substring(0,3))-****-****"
  } else {
    Write-Host "    presente mas curto — ative de novo no painel"
  }
} else {
  Write-Host "    AUSENTE — depois, ative em http://localhost:3000/licenca"
}

Write-Host "==> Reiniciando api + worker..."
$compose = Get-ComposeFile $Root
docker compose -f $compose up -d api worker
docker compose -f $compose restart api worker
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "==> Log worker:"
docker compose -f $compose logs worker --tail 25

Write-Host ""
Write-Host "=============================================="
Write-Host " Se ainda falhar: ative em http://localhost:3000/licenca"
Write-Host " e rode de novo este script."
Write-Host "=============================================="
