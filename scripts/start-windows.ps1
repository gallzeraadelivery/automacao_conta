# Sobe o stack (se precisar) e abre o painel em janela nativa (Electron).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker não encontrado. Rode scripts\install-windows.ps1 primeiro."
  exit 1
}

try { docker info | Out-Null } catch {
  Write-Host "Abra o Docker Desktop e espere ficar Running."
  exit 1
}

Write-Host "==> Garantindo containers..."
docker compose -f infra/docker/docker-compose.yml up -d

Write-Host "==> Aguardando painel (http://localhost:3000)..."
for ($i = 1; $i -le 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/login" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -lt 500) { break }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not (Test-Path "apps\desktop-shell\node_modules\electron")) {
  Write-Host "==> Instalando Electron do painel..."
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm install --filter "@uber-automation/desktop-shell..."
  } else {
    Push-Location apps\desktop-shell
    npm install
    Pop-Location
  }
}

Write-Host "==> Abrindo painel em janela..."
pnpm --filter @uber-automation/desktop-shell start
