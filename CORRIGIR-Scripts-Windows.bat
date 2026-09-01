@echo off
REM Baixa scripts Windows corrigidos do GitHub (use se INSTALAR/ATUALIZAR der erro de sintaxe).
cd /d "%~dp0"
echo Uber Automation - corrigir scripts Windows
echo Pasta: %CD%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\repair-windows-scripts.ps1"
set STATUS=%ERRORLEVEL%
echo.
if %STATUS% neq 0 (
  echo Falhou ^(codigo %STATUS%^).
) else (
  echo OK. Agora rode ATUALIZAR-Windows.bat
)
pause
exit /b %STATUS%
