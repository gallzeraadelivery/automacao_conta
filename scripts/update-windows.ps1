# Atualiza codigo + reconstrui/reinicia o stack Docker (PowerShell 5.1).
$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "docker-windows.ps1")
. (Join-Path $PSScriptRoot "node-windows.ps1")

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

Ensure-DockerReady

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

function Ensure-EnvFile {
  if (-not (Test-Path ".env")) {
    if (-not (Test-Path ".env.example")) {
      Write-Log "ERRO: falta .env e .env.example nesta pasta."
      exit 1
    }
    Write-Log "==> Criando .env a partir de .env.example (nao vai no git)"
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
    Write-Log "==> .env mock -> production"
    $envText = $envText -replace '(?m)^AUTOMATION_TARGET=mock\s*$', 'AUTOMATION_TARGET=production'
  }
  if ($envText -notmatch '(?m)^AUTOMATION_TARGET=') {
    $envText += "`nAUTOMATION_TARGET=production"
  }
  if ($envText -notmatch '(?m)^LICENSE_ENABLED=') {
    $envText += "`nLICENSE_ENABLED=true"
  }
  Set-Content -Path ".env" -Value $envText -NoNewline

  if (-not (Test-Path "storage")) {
    New-Item -ItemType Directory -Path "storage" | Out-Null
  }

  if (-not (Test-Path ".secrets.key")) {
    Write-Log "==> Gerando .secrets.key"
    $key = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
    Set-Content -Path ".secrets.key" -Value $key -NoNewline
  }
}

Ensure-EnvFile

Start-AutomationStack -Root $Root -Build -OnLine { param($Line) Write-Log $Line }
if (-not (Verify-StackRunning -Root $Root -OnLine { param($Line) Write-Log $Line })) {
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

Write-Log "==> Migrando banco..."
Invoke-DatabaseMigrate -Root $Root -OnLine { param($Line) Write-Log $Line } | Out-Null

Write-Log "==> Conferindo worker..."
docker exec uber-automation-worker-1 printenv AUTOMATION_TARGET 2>$null | ForEach-Object {
  Write-Log "    AUTOMATION_TARGET=$_"
}

Refresh-PathEnv
Add-UserNpmToPath
Refresh-PathEnv
Add-UserNpmToPath
if (Find-PnpmCmd) {
  Write-Log "==> Atualizando deps do painel (pnpm)..."
  if ((Invoke-PnpmTry install --frozen-lockfile) -ne 0) {
    Invoke-PnpmTry install 2>&1 | ForEach-Object { Write-Log "    $_" }
  } else {
    Write-Log "    pnpm install OK"
  }
}

Write-Log ""
Write-Log "=============================================="
Write-Log " Atualizacao concluida."
Write-Log " Log: $LogFile"
Write-Log " Abra o painel: Iniciar-Windows.bat"
Write-Log "=============================================="
