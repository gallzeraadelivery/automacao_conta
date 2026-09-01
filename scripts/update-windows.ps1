# Atualiza código + reconstrói/reinicia o stack Docker (API, web, worker).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Host "==> Uber Automation — atualizar"
Write-Host "    Pasta: $Root"
Write-Host ""

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
}
Refresh-Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "ERRO: Docker não encontrado. Rode INSTALAR-Windows.bat primeiro."
  exit 1
}

try {
  docker info 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "down" }
} catch {
  Write-Host "Abrindo Docker Desktop..."
  $dockerApp = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dockerApp) { Start-Process $dockerApp }
  $ready = $false
  for ($i = 1; $i -le 60; $i++) {
    try { docker info 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $ready = $true; break } } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    Write-Host "ERRO: Docker ainda não Running."
    exit 1
  }
}

if (Test-Path ".git") {
  $branch = git branch --show-current 2>$null
  if (-not $branch) { $branch = "?" }
  Write-Host "==> Branch atual: $branch"
  Write-Host "==> git pull..."
  try { git pull --ff-only } catch { git pull }
  $hash = git rev-parse --short HEAD 2>$null
  $subject = git log -1 --pretty=%s 2>$null
  Write-Host "    Commit: $hash — $subject"
} else {
  Write-Host "AVISO: sem .git — pulando pull."
}

if (Test-Path ".env") {
  $envText = Get-Content ".env" -Raw
  if ($envText -match '(?m)^AUTOMATION_TARGET=mock\s*$') {
    Write-Host "==> .env mock → production"
    $envText = $envText -replace '(?m)^AUTOMATION_TARGET=mock\s*$', 'AUTOMATION_TARGET=production'
    Set-Content -Path ".env" -Value $envText -NoNewline
  }
}

Write-Host "==> Rebuild + restart (postgres/redis/api/web/worker)..."
docker compose -f infra/docker/docker-compose.yml up -d --build

Write-Host "==> Aguardando API..."
for ($i = 1; $i -le 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -lt 500) { Write-Host "    API OK"; break }
  } catch { Start-Sleep -Seconds 2 }
}

Write-Host "==> Conferindo worker..."
try {
  $t = docker exec uber-automation-worker-1 printenv AUTOMATION_TARGET
  Write-Host "    AUTOMATION_TARGET=$t"
} catch {
  Write-Host "    (não conseguiu ler AUTOMATION_TARGET)"
}

Write-Host ""
Write-Host "=============================================="
Write-Host " Atualização concluída."
Write-Host " Abra o painel: Iniciar-Windows.bat"
Write-Host "=============================================="
