# Instalação automática no Windows — stack Docker como hoje + deps do painel em janela.
# Execute no PowerShell (como usuário normal; Docker Desktop já deve estar instalável):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\install-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Host "==> Uber Automation — instalação (Windows)"
Write-Host "    Pasta: $Root"
Write-Host ""

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "docker")) {
  Write-Host "ERRO: Docker não encontrado."
  Write-Host "Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/"
  Write-Host "Depois reinicie o PC e rode este script de novo."
  exit 1
}

try {
  docker info | Out-Null
} catch {
  Write-Host "Docker instalado, mas o daemon não está rodando."
  Write-Host "Abra o Docker Desktop, espere ficar 'Running' e rode de novo."
  exit 1
}

if (-not (Test-Command "node")) {
  Write-Host "ERRO: Node.js não encontrado (precisa >= 20)."
  Write-Host "Instale: https://nodejs.org/ (LTS) e reabra o PowerShell."
  exit 1
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt 20) {
  Write-Host "ERRO: Node >= 20 necessário (atual: $(node -v))"
  exit 1
}

if (-not (Test-Command "pnpm")) {
  Write-Host "==> Habilitando pnpm (corepack)..."
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
}

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
  Write-Host "    Revise .env se precisar (proxies, IMAP, etc.)."
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
Write-Host " Para abrir o painel em JANELA (não no browser):"
Write-Host "   • Clique duas vezes em: Iniciar-Windows.bat"
Write-Host "   • Ou no PowerShell: .\scripts\start-windows.ps1"
Write-Host " Login padrão (se seed rodou): admin@example.com / admin123"
Write-Host "=============================================="
