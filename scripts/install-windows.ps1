# Instalação automática no Windows.
# Instala o que faltar (Docker Desktop, Node LTS via winget) e sobe o stack.
# Preferir: clique duplo em INSTALAR-Windows.bat

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Host "==> Uber Automation — instalação (Windows)"
Write-Host "    Pasta: $Root"
$psVersion = $PSVersionTable.PSVersion.ToString()
Write-Host "    PowerShell: $psVersion"
Write-Host ""

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Install-WithWinget([string]$Id, [string]$Label) {
  if (-not (Test-Command "winget")) {
    Write-Host "ERRO: winget não encontrado. Atualize o Windows / App Installer e tente de novo."
    Write-Host "Ou instale manualmente: $Label"
    exit 1
  }
  Write-Host "==> Instalando $Label via winget ($Id)..."
  winget install -e --id $Id --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -gt 1) {
    Write-Host "ERRO: winget falhou ao instalar $Label (código $LASTEXITCODE)."
    exit 1
  }
  Refresh-Path
}

function Wait-DockerReady([int]$MaxAttempts = 90) {
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      docker info 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "    Docker OK (${i} tentativas)"
        return $true
      }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

# --- Docker Desktop ---
Refresh-Path
if (-not (Test-Command "docker")) {
  Install-WithWinget "Docker.DockerDesktop" "Docker Desktop"
  Refresh-Path
  if (-not (Test-Command "docker")) {
    Write-Host ""
    Write-Host "Docker Desktop foi instalado, mas o comando 'docker' ainda não está no PATH."
    Write-Host "1) Abra o Docker Desktop pelo menu Iniciar"
    Write-Host "2) Complete o setup (WSL2 se pedir) e REINICIE o PC se solicitado"
    Write-Host "3) Rode de novo: INSTALAR-Windows.bat"
    exit 1
  }
}

# Sobe o Docker Desktop se o daemon estiver parado
try {
  docker info 2>$null | Out-Null
  $dockerOk = ($LASTEXITCODE -eq 0)
} catch {
  $dockerOk = $false
}

if (-not $dockerOk) {
  Write-Host "==> Abrindo Docker Desktop e aguardando ficar Running..."
  $dockerApp = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dockerApp) {
    Start-Process $dockerApp
  } else {
    Start-Process "Docker Desktop" -ErrorAction SilentlyContinue
  }
  if (-not (Wait-DockerReady 90)) {
    Write-Host "ERRO: Docker Desktop instalado, mas ainda não está Running."
    Write-Host "Abra o Docker Desktop, aceite WSL2/reinício se pedir, e rode INSTALAR-Windows.bat de novo."
    exit 1
  }
}

# --- Node.js 20+ ---
Refresh-Path
$needNode = $false
if (-not (Test-Command "node")) {
  $needNode = $true
} else {
  $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
  if ($nodeMajor -lt 20) { $needNode = $true }
}

if ($needNode) {
  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
  Refresh-Path
  if (-not (Test-Command "node")) {
    Write-Host "ERRO: Node instalado, mas ainda não está no PATH. Feche e abra o PowerShell / rode INSTALAR-Windows.bat de novo."
    exit 1
  }
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt 20) {
  Write-Host "ERRO: Node >= 20 necessário (atual: $(node -v))"
  exit 1
}
Write-Host "    Node $(node -v)"

# --- pnpm ---
if (-not (Test-Command "pnpm")) {
  Write-Host "==> Habilitando pnpm (corepack)..."
  try {
    corepack enable
    corepack prepare pnpm@10.33.0 --activate
  } catch {
    npm install -g pnpm@10.33.0
  }
  Refresh-Path
}

if (-not (Test-Command "pnpm")) {
  Write-Host "ERRO: pnpm não ficou disponível."
  exit 1
}
Write-Host "    pnpm $(pnpm -v)"

# --- .env / chave ---
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

# Garante Uber real (evita mock-server inexistente no compose padrão)
$envText = Get-Content ".env" -Raw
if ($envText -match '(?m)^AUTOMATION_TARGET=mock\s*$') {
  Write-Host "==> Ajustando AUTOMATION_TARGET=production no .env"
  $envText = $envText -replace '(?m)^AUTOMATION_TARGET=mock\s*$', 'AUTOMATION_TARGET=production'
  Set-Content -Path ".env" -Value $envText -NoNewline
}
if ($envText -notmatch '(?m)^AUTOMATION_TARGET=') {
  Add-Content -Path ".env" -Value "`nAUTOMATION_TARGET=production"
}

$envText = Get-Content ".env" -Raw
if ($envText -match '(?m)^LICENSE_KEY=GD-XXXX-XXXX\s*$' -or $envText -notmatch '(?m)^LICENSE_KEY=') {
  Write-Host ""
  Write-Host "==> Chave de licença (formato GD-XXXX-XXXX)"
  Write-Host "    Gere em https://automacao.gdapps.online"
  Write-Host "    Pressione Enter sem digitar para instalar sem licença (configure depois no .env)."
  $licenseInput = Read-Host "LICENSE_KEY"
  if ($null -eq $licenseInput) { $licenseInput = "" }
  $licenseInput = $licenseInput.Trim().ToUpperInvariant()
  if ($licenseInput) {
    if ($envText -match '(?m)^LICENSE_KEY=') {
      $envText = $envText -replace '(?m)^LICENSE_KEY=.*$', "LICENSE_KEY=$licenseInput"
    } else {
      $envText += "`nLICENSE_KEY=$licenseInput"
    }
    if ($envText -notmatch '(?m)^LICENSE_ENABLED=') {
      $envText += "`nLICENSE_ENABLED=true"
    } else {
      $envText = $envText -replace '(?m)^LICENSE_ENABLED=.*$', 'LICENSE_ENABLED=true'
    }
    Set-Content -Path ".env" -Value $envText -NoNewline
  } else {
    Write-Host "    Sem chave agora — desabilitando verificação de licença (LICENSE_ENABLED=false)."
    Write-Host "    Depois edite .env com LICENSE_KEY=GD-XXXX-XXXX e LICENSE_ENABLED=true"
    if ($envText -match '(?m)^LICENSE_ENABLED=') {
      $envText = $envText -replace '(?m)^LICENSE_ENABLED=.*$', 'LICENSE_ENABLED=false'
    } else {
      $envText += "`nLICENSE_ENABLED=false"
    }
    if ($envText -match '(?m)^LICENSE_KEY=GD-XXXX-XXXX') {
      $envText = $envText -replace '(?m)^LICENSE_KEY=GD-XXXX-XXXX\s*$', 'LICENSE_KEY='
    }
    Set-Content -Path ".env" -Value $envText -NoNewline
  }
}

if (-not (Test-Path ".secrets.key")) {
  Write-Host "==> Gerando .secrets.key"
  $key = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
  Set-Content -Path ".secrets.key" -Value $key -NoNewline
}

Write-Host "==> Instalando dependências do monorepo (painel em janela)..."
try {
  pnpm install --frozen-lockfile
} catch {
  pnpm install
}

Write-Host "==> Subindo stack Docker (postgres, redis, api, web, worker)..."
docker compose -f infra/docker/docker-compose.yml up -d --build

Write-Host "==> Aguardando API ficar saudável..."
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
  Write-Host "AVISO: API ainda não respondeu — confira: docker compose -f infra/docker/docker-compose.yml logs api"
}

Write-Host "==> Seed do admin (se ainda não existir)..."
try { pnpm db:migrate } catch { }
$env:SEED_ADMIN_EMAIL = if ($env:SEED_ADMIN_EMAIL) { $env:SEED_ADMIN_EMAIL } else { "admin@example.com" }
$env:SEED_ADMIN_PASSWORD = if ($env:SEED_ADMIN_PASSWORD) { $env:SEED_ADMIN_PASSWORD } else { "admin123" }
try {
  pnpm db:seed
} catch {
  Write-Host "    (seed ignorado — provavelmente já rodou)"
}

Write-Host ""
Write-Host "=============================================="
Write-Host " Instalação concluída."
Write-Host " Para abrir o painel em JANELA:"
Write-Host "   • Clique duas vezes em: Iniciar-Windows.bat"
Write-Host " Login: admin@example.com / admin123"
Write-Host "=============================================="
