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
