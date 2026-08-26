#!/usr/bin/env bash
# Sobe o stack (se precisar) e abre o painel em janela nativa (Electron).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f infra/docker/docker-compose.yml"

if ! docker info >/dev/null 2>&1; then
  echo "Docker não está rodando. Abrindo Docker Desktop..."
  open -a Docker 2>/dev/null || true
  echo "Espere o Docker ficar pronto e rode de novo."
  exit 1
fi

echo "==> Garantindo containers..."
$COMPOSE up -d

echo "==> Aguardando painel (http://localhost:3000)..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:3000/login" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if [[ ! -d apps/desktop-shell/node_modules/electron ]]; then
  echo "==> Instalando Electron do painel..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --filter @uber-automation/desktop-shell...
  else
    (cd apps/desktop-shell && npm install)
  fi
fi

echo "==> Abrindo painel em janela..."
pnpm --filter @uber-automation/desktop-shell start
