@echo off
REM Clique duas vezes para ATUALIZAR (git pull + rebuild Docker).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-windows.ps1"
echo.
pause
