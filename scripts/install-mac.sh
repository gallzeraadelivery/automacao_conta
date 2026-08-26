#!/usr/bin/env bash
# Instalação automática no macOS — sobe o stack Docker como hoje + deps do painel em janela.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Uber Automation — instalação (macOS)"
echo "    Pasta: $ROOT"
echo

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERRO: '$1' não encontrado. $2"
    exit 1
  fi
}

# --- Docker Desktop ---
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado."
  if command -v brew >/dev/null 2>&1; then
    echo "==> Instalando Docker Desktop via Homebrew..."
    brew install --cask docker
    echo "Abra o Docker Desktop uma vez (Aplicativos → Docker) e espere o ícone da baleia ficar verde."
    echo "Depois rode este script de novo: ./scripts/install-mac.sh"
    open -a Docker 2>/dev/null || true
    exit 0
  fi
  echo "Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

need_cmd docker "Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/"

if ! docker info >/dev/null 2>&1; then
  echo "Docker instalado, mas o daemon não está rodando."
  echo "Abrindo Docker Desktop..."
  open -a Docker 2>/dev/null || true
  echo "Aguarde o Docker ficar pronto e rode de novo: ./scripts/install-mac.sh"
  exit 1
fi

# --- Node (só para a janela Electron do painel) ---
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado."
  if command -v brew >/dev/null 2>&1; then
    echo "==> Instalando Node.js 22 via Homebrew..."
    brew install node@22 || brew install node
  else
    echo "Instale Node 20+: https://nodejs.org/"
    exit 1
  fi
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERRO: Node >= 20 necessário (atual: $(node -v))"
  exit 1
fi

# --- pnpm ---
if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> Habilitando pnpm (corepack)..."
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
fi

# --- .env / chave ---
if [[ ! -f .env ]]; then
  echo "==> Criando .env a partir de .env.example"
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    ACCESS="$(openssl rand -hex 32)"
    REFRESH="$(openssl rand -hex 32)"
    CRED="$(openssl rand -hex 32)"
    # macOS sed
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

# --- Stack Docker (mesmo fluxo de produção local) ---
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

# Seed best-effort (se o banco já tiver admin, ignora erro)
echo "==> Seed do admin (se ainda não existir)..."
pnpm db:migrate 2>/dev/null || true
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}" \
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-admin123}" \
  pnpm db:seed 2>/dev/null || echo "    (seed ignorado — provavelmente já rodou)"

chmod +x "$ROOT/Iniciar-Mac.command" "$ROOT/scripts/start-mac.sh" 2>/dev/null || true

echo
echo "=============================================="
echo " Instalação concluída."
echo " Para abrir o painel em JANELA (não no browser):"
echo "   • Clique duas vezes em: Iniciar-Mac.command"
echo "   • Ou no Terminal: ./scripts/start-mac.sh"
echo " Login padrão (se seed rodou): admin@example.com / admin123"
echo "=============================================="
