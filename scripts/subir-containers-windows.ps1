# Sobe ou reconstrui o stack Docker (postgres, redis, api, web, worker).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "docker-windows.ps1")

Write-Host "==> Uber Automation - subir containers"
Write-Host "    Pasta: $Root"
Write-Host ""

Ensure-DockerReady

if (-not (Test-Path ".env")) {
  Write-Host "ERRO: .env nao encontrado. Rode INSTALAR-Windows.bat primeiro."
  exit 1
}

Start-AutomationStack -Root $Root -Build
if (-not (Verify-StackRunning -Root $Root)) {
  exit 1
}

Write-Host ""
Write-Host "Containers no ar. Abra: http://localhost:3000"
