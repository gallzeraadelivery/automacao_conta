# Sobe o stack (se precisar) e abre o painel em janela nativa (Electron).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
}
Refresh-Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker não encontrado. Rode INSTALAR-Windows.bat primeiro."
  exit 1
}

try {
  docker info 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "docker down" }
} catch {
  Write-Host "Abrindo Docker Desktop..."
  $dockerApp = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dockerApp) { Start-Process $dockerApp }
  $ready = $false
  for ($i = 1; $i -le 60; $i++) {
    try {
      docker info 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    Write-Host "ERRO: Docker ainda não está Running."
    exit 1
  }
}

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
  Write-Host "AVISO: painel ainda não respondeu em :3000"
}

$electronBin = "apps\desktop-shell\node_modules\.bin\electron.cmd"
if (-not (Test-Path "apps\desktop-shell\node_modules\electron")) {
  Write-Host "==> Instalando Electron do painel..."
  Refresh-Path
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm install --filter "@uber-automation/desktop-shell..."
  } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    Push-Location apps\desktop-shell
    npm install
    Pop-Location
  } else {
    Write-Host "ERRO: pnpm/npm não encontrados. Rode INSTALAR-Windows.bat de novo."
    exit 1
  }
}

Write-Host "==> Abrindo painel em janela..."
Set-Location apps\desktop-shell
if (Test-Path "node_modules\.bin\electron.cmd") {
  & ".\node_modules\.bin\electron.cmd" .
  exit $LASTEXITCODE
}
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  pnpm start
  exit $LASTEXITCODE
}
Write-Host "ERRO: Electron não encontrado."
exit 1
