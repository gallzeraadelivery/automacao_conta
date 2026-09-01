@echo off
REM Clique duas vezes para ATUALIZAR (git pull + rebuild Docker).
cd /d "%~dp0"
echo Uber Automation - atualizar (pull + rebuild)
echo.

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-windows.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-windows.ps1"
)

set STATUS=%ERRORLEVEL%
echo.
if %STATUS% neq 0 (
  echo Falhou ^(codigo %STATUS%^). Veja update-windows.log na pasta do projeto.
)
pause
exit /b %STATUS%
