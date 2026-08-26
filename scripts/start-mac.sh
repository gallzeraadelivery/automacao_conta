#!/usr/bin/env bash
# Sobe o stack (se precisar) e abre o painel em janela nativa (Electron).
# Importante: clique duplo no Finder NÃO carrega nvm/brew — este script carrega.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- PATH do usuário (Finder /.command vem sem nvm/brew) ---
load_user_tools() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    . "$NVM_DIR/nvm.sh"
    nvm use default >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || nvm use node >/dev/null 2>&1 || true
  fi

  export PATH="$HOME/.local/bin:$PATH"
}

load_user_tools

# Evita worker apontar para mock-server inexistente
if [[ -f .env ]] && grep -q '^AUTOMATION_TARGET=mock' .env 2>/dev/null; then
  echo "==> .env estava em mock — ajustando para AUTOMATION_TARGET=production"
  sed -i '' 's/^AUTOMATION_TARGET=mock$/AUTOMATION_TARGET=production/' .env
fi

COMPOSE="docker compose -f infra/docker/docker-compose.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: docker não encontrado. Rode INSTALAR-Mac.command primeiro."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker não está rodando. Abrindo Docker Desktop..."
  open -a Docker 2>/dev/null || true
  READY=0
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 2
  done
  if [[ "$READY" -ne 1 ]]; then
    echo "ERRO: Docker Desktop ainda não está Running. Abra e tente de novo."
    exit 1
  fi
fi

echo "==> Garantindo containers..."
$COMPOSE up -d

echo "==> Aguardando painel (http://localhost:3000)..."
WEB_OK=0
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:3000/login" >/dev/null 2>&1; then
    WEB_OK=1
    echo "    Painel OK"
    break
  fi
  sleep 2
done
if [[ "$WEB_OK" -ne 1 ]]; then
  echo "AVISO: painel ainda não respondeu em :3000 — a janela pode mostrar 'offline'."
  echo "    Confira: docker compose -f infra/docker/docker-compose.yml logs web"
fi

# Garante Electron instalado
ELECTRON_BIN="$ROOT/apps/desktop-shell/node_modules/.bin/electron"
ELECTRON_APP="$ROOT/apps/desktop-shell/node_modules/electron"
if [[ ! -x "$ELECTRON_BIN" && ! -d "$ELECTRON_APP" ]]; then
  echo "==> Instalando Electron do painel..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --filter @uber-automation/desktop-shell...
  elif command -v npm >/dev/null 2>&1; then
    (cd apps/desktop-shell && npm install)
  else
    echo "ERRO: nem pnpm nem npm no PATH."
    echo "Abra o Terminal e rode: source ~/.nvm/nvm.sh && cd \"$ROOT\" && ./scripts/start-mac.sh"
    exit 1
  fi
fi

echo "==> Abrindo painel em janela..."
cd "$ROOT/apps/desktop-shell"

# Preferência: binário local (não depende de pnpm no PATH do Finder)
if [[ -x "./node_modules/.bin/electron" ]]; then
  exec ./node_modules/.bin/electron .
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm --filter @uber-automation/desktop-shell start
fi

if command -v npx >/dev/null 2>&1; then
  exec npx electron .
fi

echo "ERRO: Electron não encontrado."
echo "Rode INSTALAR-Mac.command de novo ou no Terminal:"
echo "  source ~/.nvm/nvm.sh && cd \"$ROOT\" && pnpm --filter @uber-automation/desktop-shell start"
exit 1
