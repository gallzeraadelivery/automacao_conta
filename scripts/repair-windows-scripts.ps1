# Baixa scripts .ps1 e .bat corrigidos (ASCII) do GitHub main.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$BaseUrl = "https://raw.githubusercontent.com/gallzeraadelivery/automacao_conta/main"
$Files = @(
  "scripts/install-windows.ps1",
  "scripts/update-windows.ps1",
  "scripts/start-windows.ps1",
  "INSTALAR-Windows.bat",
  "ATUALIZAR-Windows.bat",
  "DIAGNOSTICO-Windows.bat",
  "CORRIGIR-Scripts-Windows.bat"
)

Write-Host "==> Corrigindo scripts em: $Root"
Write-Host "    Fonte: $BaseUrl"
Write-Host ""

foreach ($rel in $Files) {
  $url = "$BaseUrl/$rel"
  $out = Join-Path $Root ($rel -replace "/", [IO.Path]::DirectorySeparatorChar)
  $dir = Split-Path $out -Parent
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  Write-Host "    Baixando $rel ..."
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
  } catch {
    Write-Host "ERRO ao baixar $rel : $($_.Exception.Message)"
    exit 1
  }
}

Write-Host ""
Write-Host "Scripts atualizados com sucesso."
Write-Host "Proximo passo: ATUALIZAR-Windows.bat"
exit 0
