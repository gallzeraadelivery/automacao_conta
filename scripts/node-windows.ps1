# Node/pnpm no Windows sem precisar de admin (evita EPERM em Program Files).

function Get-UserNpmPrefix {
  return Join-Path $env:LOCALAPPDATA "uber-automation-npm"
}

function Add-UserNpmToPath {
  $prefix = Get-UserNpmPrefix
  $bin = Join-Path $prefix "node_modules\.bin"
  foreach ($entry in @($bin, $prefix)) {
    if ($env:Path -notlike "*$entry*") {
      $env:Path = "$entry;$env:Path"
    }
  }
}

function Save-UserNpmToPath {
  $prefix = Get-UserNpmPrefix
  $bin = Join-Path $prefix "node_modules\.bin"
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  if ($null -eq $userPath) { $userPath = "" }
  foreach ($entry in @($bin, $prefix)) {
    if ($userPath -notlike "*$entry*") {
      $userPath = "$entry;$userPath"
    }
  }
  [System.Environment]::SetEnvironmentVariable("Path", $userPath, "User")
}

function Ensure-Pnpm {
  Refresh-PathEnv
  Add-UserNpmToPath

  if (Test-CommandExists "pnpm") {
    Write-Host "    pnpm $(pnpm -v)"
    return
  }

  if (-not (Test-CommandExists "npm")) {
    Write-Host "ERRO: npm nao encontrado. Rode INSTALAR-Windows.bat de novo."
    exit 1
  }

  Write-Host "==> Instalando pnpm no usuario (sem admin)..."
  $prefix = Get-UserNpmPrefix
  New-Item -ItemType Directory -Force -Path $prefix | Out-Null

  npm config set prefix $prefix 2>$null | Out-Null
  npm install -g pnpm@10.33.0
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: falha ao instalar pnpm (codigo $LASTEXITCODE)."
    Write-Host "Tente abrir o PowerShell como Administrador e rode INSTALAR-Windows.bat de novo."
    exit 1
  }

  Add-UserNpmToPath
  Save-UserNpmToPath
  Refresh-PathEnv

  if (-not (Test-CommandExists "pnpm")) {
    Write-Host "ERRO: pnpm nao ficou disponivel apos instalacao."
    exit 1
  }

  Write-Host "    pnpm $(pnpm -v)"
}
