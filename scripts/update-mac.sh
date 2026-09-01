#!/usr/bin/env bash
# Atualiza código + reconstrói/reinicia o stack Docker (API, web, worker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Uber Automation — atualizar"
echo "    Pasta: $ROOT"
echo

# PATH (Finder)
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker não está Running. Abrindo Docker Desktop..."
  open -a Docker 2>/dev/null || true
  for i in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERRO: Docker Desktop ainda não está Running."
  exit 1
fi

if [[ -d .git ]]; then
  BRANCH="$(git branch --show-current 2>/dev/null || echo '?')"
  echo "==> Branch atual: $BRANCH"
  echo "==> git pull..."
  git pull --ff-only || git pull
  echo "    Commit: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
else
  echo "AVISO: pasta sem .git — pulando git pull (código local)."
fi

# Garante Uber real
if [[ -f .env ]] && grep -q '^AUTOMATION_TARGET=mock' .env 2>/dev/null; then
  echo "==> .env mock → production"
  sed -i '' 's/^AUTOMATION_TARGET=mock$/AUTOMATION_TARGET=production/' .env
fi

echo "==> Rebuild + restart (postgres/redis/api/web/worker)..."
docker compose -f infra/docker/docker-compose.yml up -d --build

echo "==> Aguardando API..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:4000/health" >/dev/null 2>&1; then
    echo "    API OK"
    break
  fi
  sleep 2
done

echo "==> Conferindo worker (Let's go / production)..."
TARGET="$(docker exec uber-automation-worker-1 printenv AUTOMATION_TARGET 2>/dev/null || echo '?')"
echo "    AUTOMATION_TARGET=$TARGET"
docker exec uber-automation-worker-1 grep -n "let" /app/packages/platform-adapters/src/adapters/uber-real/steps/PreferencesSteps.ts 2>/dev/null | head -3 || \
  echo "    (regex Let's go ainda não visível no container — rebuild pode ter falhado)"

# deps do painel em janela (opcional)
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1 || true
fi

chmod +x \
  "$ROOT/ATUALIZAR-Mac.command" \
  "$ROOT/INSTALAR-Mac.command" \
  "$ROOT/Iniciar-Mac.command" \
  "$ROOT/scripts/"*.sh 2>/dev/null || true

echo
echo "=============================================="
echo " Atualização concluída."
echo " Abra o painel: Iniciar-Mac.command"
echo "=============================================="
