@echo off
REM Clique duas vezes neste arquivo para iniciar o painel em janela.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
if errorlevel 1 pause
