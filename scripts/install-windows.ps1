# Instalacao automatica no Windows (compativel com PowerShell 5.1).
# Instala automaticamente tudo que faltar: winget, Docker, Node, pnpm, Git.
# Use: clique duplo em INSTALAR-Windows.bat

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "docker-windows.ps1")
. (Join-Path $PSScriptRoot "node-windows.ps1")

$LogFile = Join-Path $Root "install-windows.log"
function Write-Log([string]$Message) {
  Write-Host $Message
  Add-Content -Path $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -Encoding UTF8
}

Write-Log "==> Uber Automation - instalacao (Windows)"
Write-Log "    Pasta: $Root"
Write-Log "    PowerShell: $($PSVersionTable.PSVersion)"
Write-Log "    Log: $LogFile"
Write-Log ""

Ensure-WindowsPrerequisites

if (-not (Test-Path ".env")) {
  Write-Log "==> Criando .env a partir de .env.example"
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
  Write-Log "==> Ajustando AUTOMATION_TARGET=production no .env"
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
  Write-Log "==> Gerando .secrets.key"
  $key = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
  Set-Content -Path ".secrets.key" -Value $key -NoNewline
}

# Containers PRIMEIRO (mais importante) — build demora na 1a vez
Start-AutomationStack -Root $Root -Build -OnLine { param($Line) Write-Log $Line }

if (-not (Verify-StackRunning -Root $Root -OnLine { param($Line) Write-Log $Line })) {
  exit 1
}

Write-Log "==> Instalando dependencias do monorepo (painel em janela)..."
if ((Invoke-PnpmTry install --frozen-lockfile) -ne 0) {
  Invoke-Pnpm install
}

Write-Log "==> Aguardando API ficar saudavel..."
$ok = $false
for ($i = 1; $i -le 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
      Write-Log "    API OK"
      $ok = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $ok) {
  Write-Log "AVISO: API ainda nao respondeu - ative a licenca no painel (http://localhost:3000/licenca)."
}

Write-Log "==> Seed do admin..."
if (-not (Invoke-DatabaseMigrate -Root $Root -OnLine { param($Line) Write-Log $Line })) {
  Write-Log "AVISO: migrate falhou - tente RESET-Admin-Windows.bat depois."
}
if (-not (Invoke-DatabaseSeed -Root $Root -ResetPassword -OnLine { param($Line) Write-Log $Line })) {
  Write-Log "AVISO: seed falhou - rode RESET-Admin-Windows.bat"
}

Write-Log ""
Write-Log "=============================================="
Write-Log " Instalacao concluida."
Write-Log " Painel: http://localhost:3000"
Write-Log " Janela: Iniciar-Windows.bat"
Write-Log " Login: admin@example.com / admin123"
Write-Log " Licenca: http://localhost:3000/licenca"
Write-Log " Log: $LogFile"
Write-Log "=============================================="
