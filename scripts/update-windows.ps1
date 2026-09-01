# Atualiza codigo + reconstrui/reinicia o stack Docker (PowerShell 5.1).
$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$LogFile = Join-Path $Root "update-windows.log"
function Write-Log([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Write-Host $Message
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Log "==> Uber Automation - atualizar"
Write-Log "    Pasta: $Root"
Write-Log "    PowerShell: $($PSVersionTable.PSVersion)"
Write-Log ""

Refresh-Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Log "ERRO: Docker nao encontrado. Rode INSTALAR-Windows.bat primeiro."
  exit 1
}

$dockerOk = $false
try {
  docker info 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
} catch {
  $dockerOk = $false
}

if (-not $dockerOk) {
  Write-Log "Abrindo Docker Desktop..."
  $dockerApp = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dockerApp) { Start-Process $dockerApp }
  $ready = $false
  for ($i = 1; $i -le 60; $i++) {
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    Write-Log "ERRO: Docker ainda nao esta Running."
    exit 1
  }
}

if (Test-Path ".git") {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Log "ERRO: git nao encontrado. Instale Git for Windows: https://git-scm.com/download/win"
    exit 1
  }

  $branch = git rev-parse --abbrev-ref HEAD 2>$null
  if (-not $branch) { $branch = "?" }
  Write-Log "==> Branch atual: $branch"

  Write-Log "==> Remotes:"
  git remote -v 2>$null | ForEach-Object { Write-Log "    $_" }

  Write-Log "==> git fetch..."
  git fetch --all --prune 2>&1 | ForEach-Object { Write-Log "    $_" }

  Write-Log "==> git pull..."
  git pull --ff-only 2>&1 | ForEach-Object { Write-Log "    $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Log "    git pull --ff-only falhou, tentando git pull normal..."
    git pull 2>&1 | ForEach-Object { Write-Log "    $_" }
    if ($LASTEXITCODE -ne 0) {
      Write-Log "ERRO: git pull falhou. Veja: $LogFile"
      exit 1
    }
  }

  $hash = git rev-parse --short HEAD 2>$null
  $subject = git log -1 --pretty=%s 2>$null
  Write-Log "    Commit: $hash - $subject"
} else {
  Write-Log "AVISO: pasta sem .git (ZIP nao atualiza sozinho)."
  Write-Log "    Baixe de novo do GitHub ou use: git clone https://github.com/gallzeraadelivery/automacao_conta.git"
}

if (Test-Path ".env") {
  $envText = Get-Content ".env" -Raw
  if ($envText -match '(?m)^AUTOMATION_TARGET=mock\s*$') {
    Write-Log "==> .env mock -> production"
    $envText = $envText -replace '(?m)^AUTOMATION_TARGET=mock\s*$', 'AUTOMATION_TARGET=production'
    Set-Content -Path ".env" -Value $envText -NoNewline
  }
}

Write-Log "==> Rebuild + restart (postgres/redis/api/web/worker)..."
docker compose -f infra/docker/docker-compose.yml up -d --build 2>&1 | ForEach-Object { Write-Log "    $_" }
if ($LASTEXITCODE -ne 0) {
  Write-Log "ERRO: docker compose falhou (codigo $LASTEXITCODE)."
  exit 1
}

Write-Log "==> Aguardando API..."
$apiOk = $false
for ($i = 1; $i -le 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -lt 500) {
      Write-Log "    API OK"
      $apiOk = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $apiOk) {
  Write-Log "AVISO: API ainda nao respondeu - confira licenca no .env ou logs da API."
}

Write-Log "==> Conferindo worker..."
docker exec uber-automation-worker-1 printenv AUTOMATION_TARGET 2>$null | ForEach-Object {
  Write-Log "    AUTOMATION_TARGET=$_"
}

Refresh-Path
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  Write-Log "==> Atualizando deps do painel (pnpm)..."
  pnpm install --frozen-lockfile 2>&1 | ForEach-Object { Write-Log "    $_" }
  if ($LASTEXITCODE -ne 0) {
    pnpm install 2>&1 | ForEach-Object { Write-Log "    $_" }
  }
}

Write-Log ""
Write-Log "=============================================="
Write-Log " Atualizacao concluida."
Write-Log " Log: $LogFile"
Write-Log " Abra o painel: Iniciar-Windows.bat"
Write-Log "=============================================="
