@echo off
REM Sobe/reconstrui os containers Docker (use se INSTALAR nao subiu o stack).
cd /d "%~dp0"
echo Uber Automation - subir containers
echo.

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\subir-containers-windows.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\subir-containers-windows.ps1"
)

set STATUS=%ERRORLEVEL%
echo.
if %STATUS% neq 0 (
  echo Falhou ^(codigo %STATUS%^).
)
pause
exit /b %STATUS%
