# Instalacao automatica no Windows (compativel com PowerShell 5.1).
# Use: clique duplo em INSTALAR-Windows.bat

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "docker-windows.ps1")

Write-Host "==> Uber Automation - instalacao (Windows)"
Write-Host "    Pasta: $Root"
Write-Host "    PowerShell: $($PSVersionTable.PSVersion)"
Write-Host ""

function Install-WithWinget([string]$Id, [string]$Label) {
  if (-not (Test-CommandExists "winget")) {
    Write-Host "ERRO: winget nao encontrado. Atualize o Windows / App Installer e tente de novo."
    Write-Host "Ou instale manualmente: $Label"
    exit 1
  }
  Write-Host "==> Instalando $Label via winget ($Id)..."
  winget install -e --id $Id --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -gt 1) {
    Write-Host "ERRO: winget falhou ao instalar $Label (codigo $LASTEXITCODE)."
    exit 1
  }
  Refresh-PathEnv
}

Ensure-DockerReady

Refresh-PathEnv
$needNode = $false
if (-not (Test-CommandExists "node")) {
  $needNode = $true
} else {
  $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
  if ($nodeMajor -lt 20) { $needNode = $true }
}

if ($needNode) {
  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
  Refresh-PathEnv
  if (-not (Test-CommandExists "node")) {
    Write-Host "ERRO: Node instalado, mas ainda nao esta no PATH. Rode INSTALAR-Windows.bat de novo."
    exit 1
  }
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt 20) {
  Write-Host "ERRO: Node >= 20 necessario (atual: $(node -v))"
  exit 1
}
Write-Host "    Node $(node -v)"

if (-not (Test-CommandExists "pnpm")) {
  Write-Host "==> Habilitando pnpm (corepack)..."
  try {
    corepack enable
    corepack prepare pnpm@10.33.0 --activate
  } catch {
    npm install -g pnpm@10.33.0
  }
  Refresh-PathEnv
}

if (-not (Test-CommandExists "pnpm")) {
  Write-Host "ERRO: pnpm nao ficou disponivel."
  exit 1
}
Write-Host "    pnpm $(pnpm -v)"

if (-not (Test-Path ".env")) {
  Write-Host "==> Criando .env a partir de .env.example"
  Copy-Item ".env.example" ".env"
  $access = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
  $refresh = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
  $cred = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
  (Get-Content ".env" -Raw) `
    -replace "replace-with-a-long-random-secret", $access `
    -replace "replace-with-another-long-random-secret", $refresh `
    -replace "replace-with-64-hex-characters-32-byte-key", $cred |
    Set-Content ".env" -NoNewline
}

$envText = Get-Content ".env" -Raw
if ($envText -match '(?m)^AUTOMATION_TARGET=mock\s*$') {
  Write-Host "==> Ajustando AUTOMATION_TARGET=production no .env"
  $envText = $envText -replace '(?m)^AUTOMATION_TARGET=mock\s*$', 'AUTOMATION_TARGET=production'
  Set-Content -Path ".env" -Value $envText -NoNewline
}
if ($envText -notmatch '(?m)^AUTOMATION_TARGET=') {
  Add-Content -Path ".env" -Value "`nAUTOMATION_TARGET=production"
}
if ($envText -notmatch '(?m)^LICENSE_ENABLED=') {
  Add-Content -Path ".env" -Value "`nLICENSE_ENABLED=true"
}

if (-not (Test-Path "storage")) {
  New-Item -ItemType Directory -Path "storage" | Out-Null
}

if (-not (Test-Path ".secrets.key")) {
  Write-Host "==> Gerando .secrets.key"
  $key = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
  Set-Content -Path ".secrets.key" -Value $key -NoNewline
}

Write-Host "==> Instalando dependencias do monorepo (painel em janela)..."
try {
  pnpm install --frozen-lockfile
} catch {
  pnpm install
}

Write-Host "==> Subindo stack Docker (postgres, redis, api, web, worker)..."
docker compose -f infra/docker/docker-compose.yml up -d --build
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERRO: docker compose falhou (codigo $LASTEXITCODE)."
  exit 1
}

Write-Host "==> Aguardando API ficar saudavel..."
$ok = $false
for ($i = 1; $i -le 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
      Write-Host "    API OK"
      $ok = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $ok) {
  Write-Host "AVISO: API ainda nao respondeu - confira licenca no painel ou logs da API."
}

Write-Host "==> Seed do admin (se ainda nao existir)..."
try { pnpm db:migrate } catch { }
$env:SEED_ADMIN_EMAIL = if ($env:SEED_ADMIN_EMAIL) { $env:SEED_ADMIN_EMAIL } else { "admin@example.com" }
$env:SEED_ADMIN_PASSWORD = if ($env:SEED_ADMIN_PASSWORD) { $env:SEED_ADMIN_PASSWORD } else { "admin123" }
try {
  pnpm db:seed
} catch {
  Write-Host "    (seed ignorado - provavelmente ja rodou)"
}

Write-Host ""
Write-Host "=============================================="
Write-Host " Instalacao concluida."
Write-Host " Para abrir o painel em JANELA:"
Write-Host "   - Clique duas vezes em: Iniciar-Windows.bat"
Write-Host " Login: admin@example.com / admin123"
Write-Host "=============================================="
