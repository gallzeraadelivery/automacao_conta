# Sobe o stack (se precisar) e abre o painel em janela nativa (Electron).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "docker-windows.ps1")

Ensure-DockerReady

Write-Host "==> Garantindo containers..."
docker compose -f infra/docker/docker-compose.yml up -d

Write-Host "==> Aguardando painel (http://localhost:3000)..."
$webOk = $false
for ($i = 1; $i -le 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/login" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -lt 500) { $webOk = $true; Write-Host "    Painel OK"; break }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $webOk) {
  Write-Host "AVISO: painel ainda nao respondeu em :3000"
}

if (-not (Test-Path "apps\desktop-shell\node_modules\electron")) {
  Write-Host "==> Instalando Electron do painel..."
  Refresh-PathEnv
  if (Test-CommandExists "pnpm") {
    pnpm install --filter "@uber-automation/desktop-shell..."
  } elseif (Test-CommandExists "npm") {
    Push-Location apps\desktop-shell
    npm install
    Pop-Location
  } else {
    Write-Host "ERRO: pnpm/npm nao encontrados. Rode INSTALAR-Windows.bat de novo."
    exit 1
  }
}

Write-Host "==> Abrindo painel em janela..."
Set-Location apps\desktop-shell
if (Test-Path "node_modules\.bin\electron.cmd") {
  & ".\node_modules\.bin\electron.cmd" .
  exit $LASTEXITCODE
}
if (Test-CommandExists "pnpm") {
  pnpm start
  exit $LASTEXITCODE
}
Write-Host "ERRO: Electron nao encontrado."
exit 1
