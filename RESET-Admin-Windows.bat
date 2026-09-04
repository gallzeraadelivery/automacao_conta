@echo off
REM Redefine senha do admin (admin@example.com / admin123 por padrao).
cd /d "%~dp0"
echo Uber Automation - resetar senha do admin
echo.

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-admin-windows.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-admin-windows.ps1"
)

set STATUS=%ERRORLEVEL%
echo.
if %STATUS% neq 0 (
  echo Falhou ^(codigo %STATUS%^).
)
pause
exit /b %STATUS%
