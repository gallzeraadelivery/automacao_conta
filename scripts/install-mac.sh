#!/usr/bin/env bash
# Instalação automática no macOS.
# Chama `sudo` no início (pede senha 1x) quando Docker/Homebrew faltam.
# Node/pnpm instalam no usuário (sem sudo).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Uber Automation — instalação (macOS)"
echo "    Pasta: $ROOT"
echo

# Mantém o ticket do sudo vivo enquanto o instalador roda (padrão Homebrew).
SUDO_KEEPALIVE_PID=""
start_sudo_keepalive() {
  # Renova a cada 50s enquanto este script existir
  (
    while true; do
      sudo -n true 2>/dev/null || exit 0
      sleep 50
      kill -0 "$$" 2>/dev/null || exit 0
    done
  ) &
  SUDO_KEEPALIVE_PID=$!
}
stop_sudo_keepalive() {
  if [[ -n "${SUDO_KEEPALIVE_PID}" ]]; then
    kill "${SUDO_KEEPALIVE_PID}" 2>/dev/null || true
  fi
}
trap stop_sudo_keepalive EXIT

# Pede senha de admin UMA vez via `sudo` (não dá para gravar a senha no script).
ensure_sudo_once() {
  if sudo -n true 2>/dev/null; then
    echo "    sudo: já autenticado"
    start_sudo_keepalive
    return 0
  fi
  echo "==> Solicitando acesso de administrador (sudo)..."
  echo "    Digite a senha do Mac quando pedir (não aparece na tela)."
  echo "    Necessário para instalar Docker Desktop / Homebrew."
  echo
  if ! sudo -v; then
    echo "ERRO: sem sudo não dá para instalar o Docker neste Mac."
    exit 1
  fi
  start_sudo_keepalive
  echo "    sudo OK"
  echo
}

needs_admin_install=0
if ! command -v docker >/dev/null 2>&1; then
  needs_admin_install=1
fi
# Homebrew em Mac Apple Silicon / Intel
if ! command -v brew >/dev/null 2>&1 \
  && [[ ! -x /opt/homebrew/bin/brew ]] \
  && [[ ! -x /usr/local/bin/brew ]]; then
  if [[ "$needs_admin_install" -eq 1 ]]; then
    needs_admin_install=1
  fi
fi

if [[ "$needs_admin_install" -eq 1 ]]; then
  ensure_sudo_once
else
  echo "    Docker já presente — sudo não necessário nesta etapa."
  echo
fi

append_brew_path() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
}

ensure_node_user() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [[ "$major" -ge 20 ]]; then
      echo "    Node $(node -v) (já instalado)"
      return 0
    fi
  fi

  echo "==> Instalando Node.js 22 no seu usuário (nvm — sem sudo)..."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  load_nvm
  nvm install 22
  nvm alias default 22
  hash -r 2>/dev/null || true

  if ! command -v node >/dev/null 2>&1; then
    echo "ERRO: Node não ficou disponível após nvm."
    exit 1
  fi
  echo "    Node $(node -v)"
}

ensure_pnpm() {
  load_nvm 2>/dev/null || true
  if command -v pnpm >/dev/null 2>&1; then
    echo "    pnpm $(pnpm -v)"
    return 0
  fi

  echo "==> Instalando pnpm (sem sudo, via corepack/npm do Node do usuário)..."
  if command -v corepack >/dev/null 2>&1; then
    # corepack enable às vezes pede sudo no Node do sistema — tenta sem; se falhar usa npm -g no prefix do usuário
    if ! corepack enable 2>/dev/null; then
      mkdir -p "$HOME/.local/bin"
      npm config set prefix "$HOME/.local"
      export PATH="$HOME/.local/bin:$PATH"
      npm install -g pnpm@10.33.0
    else
      corepack prepare pnpm@10.33.0 --activate
    fi
  else
    mkdir -p "$HOME/.local/bin"
    npm config set prefix "$HOME/.local"
    export PATH="$HOME/.local/bin:$PATH"
    npm install -g pnpm@10.33.0
  fi

  # Garante PATH para esta sessão
  export PATH="$HOME/.local/bin:$PATH"
  load_nvm 2>/dev/null || true

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "ERRO: pnpm não ficou disponível."
    exit 1
  fi
  echo "    pnpm $(pnpm -v)"
}

# --- Docker Desktop (precisa privilégio de admin na 1ª instalação) ---
if ! command -v docker >/dev/null 2>&1; then
  append_brew_path
  if ! command -v brew >/dev/null 2>&1; then
    echo "==> Homebrew não encontrado (usado para instalar o Docker)."
    echo "    Vai pedir SENHA DE ADMINISTRADOR agora..."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    append_brew_path
  fi

  if ! command -v brew >/dev/null 2>&1; then
    echo "ERRO: Homebrew não ficou disponível."
    echo "Instale o Docker Desktop manualmente: https://www.docker.com/products/docker-desktop/"
    echo "Depois rode INSTALAR-Mac.command de novo."
    exit 1
  fi

  echo "==> Instalando Docker Desktop (pode pedir senha de administrador)..."
  brew install --cask docker
fi

if ! docker info >/dev/null 2>&1; then
  echo "==> Abrindo Docker Desktop e aguardando ficar pronto..."
  open -a Docker 2>/dev/null || open -a "Docker" 2>/dev/null || true
  READY=0
  for i in $(seq 1 90); do
    if docker info >/dev/null 2>&1; then
      echo "    Docker OK"
      READY=1
      break
    fi
    sleep 2
  done
  if [[ "$READY" -ne 1 ]]; then
    echo "ERRO: Docker Desktop instalado, mas ainda não está Running."
    echo "Abra o ícone da baleia, complete o setup e rode INSTALAR-Mac.command de novo."
    exit 1
  fi
fi
echo "    Docker OK"

# --- Node + pnpm (usuário, sem sudo) ---
ensure_node_user
ensure_pnpm

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
fi

if [[ ! -f .secrets.key ]]; then
  echo "==> Gerando .secrets.key"
  openssl rand -hex 32 > .secrets.key
fi

echo "==> Instalando dependências do monorepo (painel em janela)..."
pnpm install --frozen-lockfile || pnpm install

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
    echo "AVISO: API ainda não respondeu — docker compose -f infra/docker/docker-compose.yml logs api"
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
echo " Abrir painel: clique em Iniciar-Mac.command"
echo " Login: admin@example.com / admin123"
echo "=============================================="
