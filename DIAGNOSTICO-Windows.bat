@echo off
REM Gera diagnostico rapido para suporte (cole o conteudo do log no chat).
cd /d "%~dp0"
set LOG=%~dp0diagnostico-windows.txt
echo Uber Automation — diagnostico > "%LOG%"
echo Data: %DATE% %TIME% >> "%LOG%"
echo Pasta: %CD% >> "%LOG%"
echo. >> "%LOG%"

echo === PowerShell === >> "%LOG%"
powershell -NoProfile -Command "$PSVersionTable.PSVersion" >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo === Git === >> "%LOG%"
where git >> "%LOG%" 2>&1
git --version >> "%LOG%" 2>&1
git status -sb >> "%LOG%" 2>&1
git remote -v >> "%LOG%" 2>&1
git log -1 --oneline >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo === Docker === >> "%LOG%"
where docker >> "%LOG%" 2>&1
docker --version >> "%LOG%" 2>&1
docker info >> "%LOG%" 2>&1
docker compose -f infra/docker/docker-compose.yml ps >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo === API / Web === >> "%LOG%"
powershell -NoProfile -Command "try { (Invoke-WebRequest http://127.0.0.1:4000/health -UseBasicParsing -TimeoutSec 3).StatusCode } catch { $_.Exception.Message }" >> "%LOG%" 2>&1
powershell -NoProfile -Command "try { (Invoke-WebRequest http://127.0.0.1:3000/login -UseBasicParsing -TimeoutSec 3).StatusCode } catch { $_.Exception.Message }" >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo === .env (sem segredos) === >> "%LOG%"
powershell -NoProfile -Command "if (Test-Path .env) { Get-Content .env | Where-Object { $_ -notmatch 'SECRET|PASSWORD|KEY=' } }" >> "%LOG%" 2>&1

echo.
echo Diagnostico salvo em:
echo %LOG%
echo Abra o arquivo e cole aqui no chat.
pause
