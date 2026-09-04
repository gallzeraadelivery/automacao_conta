# Redefine a senha do admin no banco Docker (postgres).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "docker-windows.ps1")

$Email = if ($env:SEED_ADMIN_EMAIL) { $env:SEED_ADMIN_EMAIL } else { "admin@example.com" }
$Password = if ($env:SEED_ADMIN_PASSWORD) { $env:SEED_ADMIN_PASSWORD } else { "admin123" }

Write-Host "==> Uber Automation - resetar senha do admin"
Write-Host "    Email: $Email"
Write-Host ""

Ensure-DockerReady

if (-not (Verify-StackRunning -Root $Root)) {
  exit 1
}

if (-not (Invoke-DatabaseMigrate -Root $Root)) {
  exit 1
}

if (-not (Invoke-DatabaseSeed -Root $Root -Email $Email -Password $Password -ResetPassword)) {
  exit 1
}

Write-Host ""
Write-Host "Senha redefinida. Login: $Email / $Password"
Write-Host "Painel: http://localhost:3000/login"
