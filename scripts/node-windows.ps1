# Node/pnpm no Windows sem precisar de admin (evita EPERM em Program Files).

$script:PnpmExecutable = $null

function Get-UserNpmPrefix {
  return Join-Path $env:LOCALAPPDATA "uber-automation-npm"
}

function Get-PnpmHome {
  return Join-Path $env:LOCALAPPDATA "pnpm"
}

function Add-UserNpmToPath {
  $prefix = Get-UserNpmPrefix
  $pnpmHome = Get-PnpmHome
  $bin = Join-Path $prefix "node_modules\.bin"
  foreach ($entry in @($pnpmHome, $bin, $prefix)) {
    if ($entry -and $env:Path -notlike "*$entry*") {
      $env:Path = "$entry;$env:Path"
    }
  }
}

function Save-UserNpmToPath {
  $prefix = Get-UserNpmPrefix
  $pnpmHome = Get-PnpmHome
  $bin = Join-Path $prefix "node_modules\.bin"
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  if ($null -eq $userPath) { $userPath = "" }
  foreach ($entry in @($pnpmHome, $bin, $prefix)) {
    if ($entry -and $userPath -notlike "*$entry*") {
      $userPath = "$entry;$userPath"
    }
  }
  [System.Environment]::SetEnvironmentVariable("Path", $userPath, "User")
}

function Find-PnpmCmd {
  if ($script:PnpmExecutable -and (Test-Path $script:PnpmExecutable)) {
    return $script:PnpmExecutable
  }

  $candidates = @(
    (Join-Path (Get-UserNpmPrefix) "pnpm.cmd"),
    (Join-Path (Get-PnpmHome) "pnpm.cmd"),
    (Join-Path (Get-UserNpmPrefix) "node_modules\.bin\pnpm.cmd")
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path $path)) {
      $script:PnpmExecutable = $path
      return $path
    }
  }

  if (Test-CommandExists "pnpm") {
    $script:PnpmExecutable = "pnpm"
    return "pnpm"
  }

  return $null
}

function Invoke-Pnpm {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PnpmArgs
  )
  $code = Invoke-PnpmTry @PnpmArgs
  if ($code -ne 0) {
    exit $code
  }
}

function Invoke-PnpmTry {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PnpmArgs
  )
  $cmd = Find-PnpmCmd
  if (-not $cmd) {
    Write-Host "ERRO: pnpm nao encontrado."
    return 1
  }
  & $cmd @PnpmArgs
  if ($null -eq $LASTEXITCODE) { return 0 }
  return $LASTEXITCODE
}

function Ensure-Node {
  Refresh-PathEnv
  $needNode = $false
  if (-not (Test-CommandExists "node")) {
    $needNode = $true
  } else {
    $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
    if ($nodeMajor -lt 20) { $needNode = $true }
  }
  if (-not $needNode) {
    Write-Host "    Node $(node -v)"
    return
  }
  Install-PackageWithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
  if (-not (Test-CommandExists "node")) {
    Write-Host "ERRO: Node instalado, mas ainda nao esta no PATH. Feche e abra o terminal e rode INSTALAR-Windows.bat de novo."
    exit 1
  }
  $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
  if ($nodeMajor -lt 20) {
    Write-Host "ERRO: Node >= 20 necessario (atual: $(node -v))"
    exit 1
  }
  Write-Host "    Node $(node -v)"
}

function Install-PnpmWithNpm {
  $prefix = Get-UserNpmPrefix
  New-Item -ItemType Directory -Force -Path $prefix | Out-Null
  npm config set prefix $prefix 2>$null | Out-Null
  npm install -g pnpm@10.33.0
  return ($LASTEXITCODE -eq 0)
}

function Install-PnpmWithOfficialScript {
  $pnpmHome = Get-PnpmHome
  New-Item -ItemType Directory -Force -Path $pnpmHome | Out-Null
  $env:PNPM_HOME = $pnpmHome
  Add-UserNpmToPath
  try {
    $installScript = Invoke-WebRequest -Uri "https://get.pnpm.io/install.ps1" -UseBasicParsing
    Invoke-Expression $installScript.Content
    return $true
  } catch {
    Write-Host "    AVISO: instalador oficial do pnpm falhou: $($_.Exception.Message)"
    return $false
  }
}

function Ensure-Pnpm {
  Refresh-PathEnv
  Add-UserNpmToPath

  $existing = Find-PnpmCmd
  if ($existing) {
    if ($existing -eq "pnpm") {
      Write-Host "    pnpm $(pnpm -v)"
    } else {
      Write-Host "    pnpm $(& $existing -v)"
    }
    return
  }

  if (-not (Test-CommandExists "npm")) {
    Write-Host "ERRO: npm nao encontrado. Rode INSTALAR-Windows.bat de novo."
    exit 1
  }

  Write-Host "==> Instalando pnpm no usuario (sem admin)..."
  $ok = Install-PnpmWithNpm
  Add-UserNpmToPath
  Save-UserNpmToPath
  Refresh-PathEnv

  if (-not (Find-PnpmCmd)) {
    Write-Host "    Tentando instalador oficial do pnpm..."
    [void](Install-PnpmWithOfficialScript)
    Add-UserNpmToPath
    Save-UserNpmToPath
    Refresh-PathEnv
  }

  $cmd = Find-PnpmCmd
  if (-not $cmd) {
    Write-Host "ERRO: pnpm nao ficou disponivel apos instalacao."
    Write-Host "    Pasta esperada: $(Get-UserNpmPrefix)"
    exit 1
  }

  if ($cmd -eq "pnpm") {
    Write-Host "    pnpm $(pnpm -v)"
  } else {
    Write-Host "    pnpm $(& $cmd -v)"
    Write-Host "    Caminho: $cmd"
  }
}

function Ensure-Git {
  Refresh-PathEnv
  if (Test-CommandExists "git") {
    Write-Host "    Git OK"
    return
  }
  Install-PackageWithWinget "Git.Git" "Git for Windows"
  Refresh-PathEnv
  if (-not (Test-CommandExists "git")) {
    Write-Host "ERRO: Git nao ficou disponivel apos instalacao."
    Write-Host "    Instale manualmente: https://git-scm.com/download/win"
    exit 1
  }
  Write-Host "    Git OK"
}

function Ensure-WindowsPrerequisites {
  Write-Host "==> Verificando dependencias (instala o que faltar)..."
  Ensure-Winget
  Ensure-DockerReady
  Ensure-Node
  Ensure-Pnpm
  Ensure-Git
  Write-Host "==> Dependencias OK (Docker, Node, pnpm, Git)"
}
