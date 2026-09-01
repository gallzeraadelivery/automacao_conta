@echo off
REM Clique duas vezes neste arquivo para INSTALAR o sistema (1a vez).
cd /d "%~dp0"
echo Uber Automation - instalacao
echo.

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
)

set STATUS=%ERRORLEVEL%
echo.
if %STATUS% neq 0 (
  echo Falhou ^(codigo %STATUS%^).
)
pause
exit /b %STATUS%
