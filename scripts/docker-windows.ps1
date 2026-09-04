# Funcoes compartilhadas para Docker Desktop no Windows (PowerShell 5.1).

function Refresh-PathEnv {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
  $extraPaths = @(
    (Join-Path ${env:ProgramFiles} "Docker\Docker\resources\bin"),
    (Join-Path ${env:ProgramFiles} "Git\cmd"),
    (Join-Path ${env:ProgramFiles(x86)} "Git\cmd"),
    (Join-Path ${env:ProgramFiles} "nodejs")
  )
  foreach ($dir in $extraPaths) {
    if ($dir -and (Test-Path $dir) -and $env:Path -notlike "*$dir*") {
      $env:Path = "$dir;$env:Path"
    }
  }
}

function Ensure-Winget {
  Refresh-PathEnv
  if (Test-CommandExists "winget") {
    return
  }
  Write-Host "==> winget nao encontrado. Tentando instalar App Installer..."
  try {
    $bundle = Join-Path $env:TEMP "Microsoft.DesktopAppInstaller.msixbundle"
    Invoke-WebRequest -Uri "https://aka.ms/getwinget" -OutFile $bundle -UseBasicParsing
    Add-AppxPackage -Path $bundle | Out-Null
  } catch {
    Write-Host "ERRO: winget e obrigatorio para instalar Docker, Node e Git automaticamente."
    Write-Host "    Instale 'App Installer' na Microsoft Store e rode INSTALAR-Windows.bat de novo."
    exit 1
  }
  Refresh-PathEnv
  if (-not (Test-CommandExists "winget")) {
    Write-Host "ERRO: winget ainda nao disponivel apos instalar App Installer."
    Write-Host "    Reinicie o PC e rode INSTALAR-Windows.bat de novo."
    exit 1
  }
}

function Install-PackageWithWinget([string]$Id, [string]$Label) {
  Ensure-Winget
  Write-Host "==> Instalando $Label via winget ($Id)..."
  winget install -e --id $Id --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -gt 1) {
    Write-Host "ERRO: winget falhou ao instalar $Label (codigo $LASTEXITCODE)."
    exit 1
  }
  Refresh-PathEnv
}

function Test-CommandExists([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Find-DockerDesktopExe {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe")
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path $path)) {
      return $path
    }
  }
  return $null
}

function Test-DockerDaemonRunning {
  if (-not (Test-CommandExists "docker")) {
    return $false
  }
  docker info 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Install-DockerDesktopWithWinget {
  Install-PackageWithWinget "Docker.DockerDesktop" "Docker Desktop"
  return $true
}

function Start-DockerDesktopApp {
  $exe = Find-DockerDesktopExe
  if (-not $exe) {
    Write-Host "    Docker Desktop.exe nao encontrado no disco."
    return $false
  }
  Write-Host "    Abrindo: $exe"
  try {
    Start-Process -FilePath $exe | Out-Null
    return $true
  } catch {
    Write-Host "    AVISO: nao foi possivel abrir o Docker Desktop automaticamente."
    Write-Host "    $($_.Exception.Message)"
    return $false
  }
}

function Wait-DockerDaemonReady([int]$MaxAttempts = 90) {
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    if (Test-DockerDaemonRunning) {
      Write-Host "    Docker OK ($i tentativas)"
      return $true
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Ensure-DockerReady {
  Refresh-PathEnv

  $desktopExe = Find-DockerDesktopExe
  $hasDockerCli = Test-CommandExists "docker"

  if (-not $hasDockerCli -and -not $desktopExe) {
    Install-PackageWithWinget "Docker.DockerDesktop" "Docker Desktop"
    $desktopExe = Find-DockerDesktopExe
    Refresh-PathEnv
    $hasDockerCli = Test-CommandExists "docker"
  }

  if (Test-DockerDaemonRunning) {
    Write-Host "    Docker ja esta Running."
    return
  }

  Write-Host "==> Docker instalado, mas ainda nao esta Running..."
  if (-not $desktopExe) {
    Write-Host "    Tentando instalar Docker Desktop novamente..."
    Install-PackageWithWinget "Docker.DockerDesktop" "Docker Desktop"
    $desktopExe = Find-DockerDesktopExe
    Refresh-PathEnv
  }

  if ($desktopExe) {
    [void](Start-DockerDesktopApp)
  } else {
    Write-Host ""
    Write-Host "Nao achei o Docker Desktop nesta maquina."
    Write-Host "1. Instale manualmente: https://www.docker.com/products/docker-desktop/"
    Write-Host "2. Ou abra pelo menu Iniciar se ja instalou"
    Write-Host "3. Aceite WSL2 e REINICIE o PC se pedir"
    Write-Host "4. Rode de novo: INSTALAR-Windows.bat"
    exit 1
  }

  if (-not (Wait-DockerDaemonReady 90)) {
    Write-Host ""
    Write-Host "ERRO: Docker Desktop ainda nao ficou Running."
    Write-Host "1. Abra o Docker Desktop pelo menu Iniciar"
    Write-Host "2. Complete o setup (WSL2 se pedir) e REINICIE o PC se solicitado"
    Write-Host "3. Rode de novo: INSTALAR-Windows.bat"
    exit 1
  }
}

function Get-ComposeFile([string]$Root) {
  return Join-Path $Root "infra\docker\docker-compose.yml"
}

function Start-AutomationStack {
  param(
    [string]$Root,
    [switch]$Build,
    [scriptblock]$OnLine = { param($Line) Write-Host $Line }
  )

  $compose = Get-ComposeFile $Root
  if (-not (Test-Path $compose)) {
    & $OnLine "ERRO: arquivo compose nao encontrado: $compose"
    exit 1
  }
  if (-not (Test-Path (Join-Path $Root ".env"))) {
    & $OnLine "ERRO: .env nao encontrado. Rode INSTALAR-Windows.bat de novo."
    exit 1
  }

  & $OnLine "==> Subindo stack Docker (postgres, redis, api, web, worker)..."
  & $OnLine "    ATENCAO: na 1a vez o build pode demorar 15-30 minutos. Nao feche esta janela."

  Push-Location $Root
  try {
    if ($Build) {
      docker compose -f $compose up -d --build 2>&1 | ForEach-Object { & $OnLine "    $_" }
    } else {
      docker compose -f $compose up -d 2>&1 | ForEach-Object { & $OnLine "    $_" }
    }
    if ($LASTEXITCODE -ne 0) {
      & $OnLine "ERRO: docker compose falhou (codigo $LASTEXITCODE)."
      exit 1
    }
  } finally {
    Pop-Location
  }
}

function Show-StackStatus {
  param(
    [string]$Root,
    [scriptblock]$OnLine = { param($Line) Write-Host $Line }
  )
  $compose = Get-ComposeFile $Root
  Push-Location $Root
  try {
    & $OnLine ""
    & $OnLine "==> Containers no Docker:"
    docker compose -f $compose ps 2>&1 | ForEach-Object { & $OnLine $_ }
  } finally {
    Pop-Location
  }
}

function Test-ComposeServiceRunning([string]$ComposeFile, [string]$Service) {
  $id = docker compose -f $ComposeFile ps -q $Service 2>$null
  if (-not $id) { return $false }
  $state = docker inspect -f "{{.State.Status}}" $id 2>$null
  return ($state -eq "running")
}

function Verify-StackRunning {
  param(
    [string]$Root,
    [scriptblock]$OnLine = { param($Line) Write-Host $Line }
  )

  $compose = Get-ComposeFile $Root
  $required = @("postgres", "redis", "api", "web", "worker")
  $missing = @()

  Push-Location $Root
  try {
    foreach ($svc in $required) {
      if (-not (Test-ComposeServiceRunning $compose $svc)) {
        $missing += $svc
      }
    }
  } finally {
    Pop-Location
  }

  Show-StackStatus $Root $OnLine

  if ($missing.Count -gt 0) {
    & $OnLine ""
    & $OnLine "ERRO: estes containers NAO estao Running: $($missing -join ', ')"
    & $OnLine "    Tente: SUBIR-Containers-Windows.bat"
    & $OnLine "    Ou veja o erro: docker compose -f infra/docker/docker-compose.yml logs api"
    return $false
  }

  & $OnLine "    Todos os containers OK."
  return $true
}

function Invoke-DatabaseMigrate {
  param(
    [string]$Root,
    [scriptblock]$OnLine = { param($Line) Write-Host $Line }
  )
  $compose = Get-ComposeFile $Root
  Push-Location $Root
  try {
    & $OnLine "==> Migrando banco de dados..."
    docker compose -f $compose exec -T api pnpm --filter @uber-automation/database db:migrate 2>&1 |
      ForEach-Object { & $OnLine $_ }
    if ($LASTEXITCODE -ne 0) {
      & $OnLine "ERRO: migrate falhou (codigo $LASTEXITCODE)."
      return $false
    }
    return $true
  } finally {
    Pop-Location
  }
}

function Invoke-DatabaseSeed {
  param(
    [string]$Root,
    [string]$Email = "admin@example.com",
    [string]$Password = "admin123",
    [switch]$ResetPassword,
    [scriptblock]$OnLine = { param($Line) Write-Host $Line }
  )
  $compose = Get-ComposeFile $Root
  $pgUser = "uber_automation"
  $pgDb = "uber_automation"
  $envPath = Join-Path $Root ".env"
  if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    if ($envContent -match '(?m)^POSTGRES_USER=(.+)$') { $pgUser = $matches[1].Trim() }
    if ($envContent -match '(?m)^POSTGRES_DB=(.+)$') { $pgDb = $matches[1].Trim() }
  }

  Push-Location $Root
  try {
    if ($ResetPassword) {
      & $OnLine "==> Removendo admin antigo (se existir)..."
      $safeEmail = $Email.Replace("'", "''")
      $sql = "DELETE FROM operators WHERE lower(email) = lower('$safeEmail');"
      docker compose -f $compose exec -T postgres psql -U $pgUser -d $pgDb -c $sql 2>&1 |
        ForEach-Object { & $OnLine $_ }
    }

    & $OnLine "==> Criando usuario admin ($Email)..."
    docker compose -f $compose exec -T `
      -e "SEED_ADMIN_EMAIL=$Email" `
      -e "SEED_ADMIN_PASSWORD=$Password" `
      api pnpm --filter @uber-automation/database db:seed 2>&1 |
      ForEach-Object { & $OnLine $_ }
    if ($LASTEXITCODE -ne 0) {
      & $OnLine "ERRO: seed falhou (codigo $LASTEXITCODE)."
      return $false
    }
    return $true
  } finally {
    Pop-Location
  }
}
