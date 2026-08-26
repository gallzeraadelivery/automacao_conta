#!/usr/bin/env bash
# Instalação automática no macOS.
# Instala o que faltar (Homebrew, Docker Desktop, Node, pnpm) e sobe o stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Uber Automation — instalação (macOS)"
echo "    Pasta: $ROOT"
echo

append_brew_path() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

# --- Homebrew (base para Docker/Node no Mac) ---
if ! command -v brew >/dev/null 2>&1; then
  echo "==> Homebrew não encontrado. Instalando..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  append_brew_path
fi
append_brew_path

if ! command -v brew >/dev/null 2>&1; then
  echo "ERRO: Homebrew não ficou disponível no PATH."
  echo "Abra um Terminal novo e rode de novo: INSTALAR-Mac.command"
  exit 1
fi

# --- Docker Desktop ---
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker não encontrado. Instalando Docker Desktop..."
  brew install --cask docker
fi

# Garante app aberto e daemon pronto (até ~3 min)
if ! docker info >/dev/null 2>&1; then
  echo "==> Abrindo Docker Desktop e aguardando ficar pronto..."
  open -a Docker 2>/dev/null || open -a "Docker" 2>/dev/null || true
  READY=0
  for i in $(seq 1 90); do
    if docker info >/dev/null 2>&1; then
      echo "    Docker OK (${i}x2s)"
      READY=1
      break
    fi
    sleep 2
  done
  if [[ "$READY" -ne 1 ]]; then
    echo "ERRO: Docker Desktop instalado, mas ainda não está Running."
    echo "Abra o ícone da baleia na barra, complete o setup (se pedir) e rode INSTALAR-Mac.command de novo."
    exit 1
  fi
fi

# --- Node.js 20+ (janela Electron do painel) ---
NEED_NODE=0
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    NEED_NODE=1
  fi
fi

if [[ "$NEED_NODE" -eq 1 ]]; then
  echo "==> Instalando Node.js 22 (Homebrew)..."
  brew install node@22 2>/dev/null || brew install node
  append_brew_path
  # node@22 às vezes fica só em Cellar — linka se preciso
  if ! command -v node >/dev/null 2>&1; then
    brew link --overwrite --force node@22 2>/dev/null || true
    append_brew_path
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: Node.js não ficou disponível. Instale LTS em https://nodejs.org/ e rode de novo."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERRO: Node >= 20 necessário (atual: $(node -v))"
  exit 1
fi
echo "    Node $(node -v)"

# --- pnpm ---
if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> Habilitando pnpm (corepack)..."
  corepack enable || true
  corepack prepare pnpm@10.33.0 --activate || npm install -g pnpm@10.33.0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERRO: pnpm não ficou disponível."
  exit 1
fi
echo "    pnpm $(pnpm -v)"

# --- .env / chave ---
if [[ ! -f .env ]]; then
  echo "==> Criando .env a partir de .env.example"
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    ACCESS="$(openssl rand -hex 32)"
    REFRESH="$(openssl rand -hex 32)"
    CRED="$(openssl rand -hex 32)"
    sed -i '' "s/replace-with-a-long-random-secret/${ACCESS}/" .env
    sed -i '' "s/replace-with-another-long-random-secret/${REFRESH}/" .env
    sed -i '' "s/replace-with-64-hex-characters-32-byte-key/${CRED}/" .env
  fi
  echo "    Revise .env se precisar (proxies, IMAP, etc.)."
fi

if [[ ! -f .secrets.key ]]; then
  echo "==> Gerando .secrets.key"
  openssl rand -hex 32 > .secrets.key
fi

# --- Dependências do shell desktop ---
echo "==> Instalando dependências do monorepo (painel em janela)..."
pnpm install --frozen-lockfile || pnpm install

# --- Stack Docker ---
echo "==> Subindo stack Docker (postgres, redis, api, web, worker)..."
docker compose -f infra/docker/docker-compose.yml up -d --build

echo "==> Aguardando API ficar saudável..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:4000/health" >/dev/null 2>&1; then
    echo "    API OK"
    break
  fi
  sleep 2
  if [[ "$i" -eq 60 ]]; then
    echo "AVISO: API ainda não respondeu em /health — confira: docker compose -f infra/docker/docker-compose.yml logs api"
  fi
done

echo "==> Seed do admin (se ainda não existir)..."
pnpm db:migrate 2>/dev/null || true
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}" \
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-admin123}" \
  pnpm db:seed 2>/dev/null || echo "    (seed ignorado — provavelmente já rodou)"

chmod +x \
  "$ROOT/INSTALAR-Mac.command" \
  "$ROOT/Iniciar-Mac.command" \
  "$ROOT/scripts/install-mac.sh" \
  "$ROOT/scripts/start-mac.sh" 2>/dev/null || true

echo
echo "=============================================="
echo " Instalação concluída."
echo " Para abrir o painel em JANELA:"
echo "   • Clique duas vezes em: Iniciar-Mac.command"
echo " Login: admin@example.com / admin123"
echo "=============================================="
