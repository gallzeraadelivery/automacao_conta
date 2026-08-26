@echo off
REM Clique duas vezes neste arquivo para INSTALAR o sistema (1a vez).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
echo.
pause
