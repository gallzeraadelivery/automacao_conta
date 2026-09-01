# Funcoes compartilhadas para Docker Desktop no Windows (PowerShell 5.1).

function Refresh-PathEnv {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
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
  if (-not (Test-CommandExists "winget")) {
    Write-Host "ERRO: winget nao encontrado. Instale o App Installer da Microsoft Store."
    Write-Host "Ou baixe o Docker Desktop: https://www.docker.com/products/docker-desktop/"
    return $false
  }
  Write-Host "==> Instalando Docker Desktop via winget..."
  winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -gt 1) {
    Write-Host "ERRO: winget falhou ao instalar Docker Desktop (codigo $LASTEXITCODE)."
    return $false
  }
  Refresh-PathEnv
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
    if (-not (Install-DockerDesktopWithWinget)) {
      exit 1
    }
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
    if (-not (Install-DockerDesktopWithWinget)) {
      exit 1
    }
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
