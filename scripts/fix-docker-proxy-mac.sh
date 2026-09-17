#!/usr/bin/env bash
# Desliga proxy HTTP/HTTPS do macOS + Docker que quebra o build
# (apt-get / playwright) com "connection refused" no proxy do sistema.
#
# Uso (na pasta do projeto ou de qualquer lugar):
#   bash scripts/fix-docker-proxy-mac.sh
#   # ou clique duplo: CORRIGIR-Proxy-Docker-Mac.command
#
# Depois: reinicie o Docker Desktop e rode de novo o INSTALAR / build.

set -euo pipefail

echo "==> Uber Automation - corrigir proxy do sistema/Docker (Mac)"
echo ""

# --- 1) Env do shell atual ---
echo "==> Limpando variaveis de proxy neste Terminal..."
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy FTP_PROXY ftp_proxy NO_PROXY no_proxy 2>/dev/null || true
echo "    OK (sessao atual)"

# --- 2) Remover exports de proxy nos arquivos de shell (backup) ---
strip_proxy_exports() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  if ! grep -Eqi '^(export[[:space:]]+)?(http|https|all|ftp)_proxy=' "$file" \
    && ! grep -Eqi '^(export[[:space:]]+)?(HTTP|HTTPS|ALL|FTP)_PROXY=' "$file"; then
    return 0
  fi
  local bak="${file}.bak-proxy-$(date +%Y%m%d%H%M%S)"
  cp "$file" "$bak"
  # Remove linhas de proxy (nao apaga o resto do arquivo)
  grep -Eiv '^(export[[:space:]]+)?(http|https|all|ftp)_proxy=' "$file" \
    | grep -Eiv '^(export[[:space:]]+)?(HTTP|HTTPS|ALL|FTP)_PROXY=' \
    > "${file}.tmp" || true
  mv "${file}.tmp" "$file"
  echo "    Removido proxy de: $file (backup: $bak)"
}

echo "==> Checando ~/.zshrc ~/.zprofile ~/.bash_profile ~/.bashrc..."
strip_proxy_exports "$HOME/.zshrc"
strip_proxy_exports "$HOME/.zprofile"
strip_proxy_exports "$HOME/.bash_profile"
strip_proxy_exports "$HOME/.bashrc"

# --- 3) Proxies da rede macOS (todas as interfaces) ---
echo "==> Desligando proxy HTTP/HTTPS nas interfaces de rede..."
while IFS= read -r service; do
  [[ -z "$service" ]] && continue
  [[ "$service" == *"asterisk"* ]] && continue
  [[ "$service" == "An asterisk"* ]] && continue
  # networksetup lista com "* " no inicio se desabilitado
  service="${service#\* }"
  networksetup -setwebproxystate "$service" off 2>/dev/null || true
  networksetup -setsecurewebproxystate "$service" off 2>/dev/null || true
  networksetup -setftpproxystate "$service" off 2>/dev/null || true
  networksetup -setsocksfirewallproxystate "$service" off 2>/dev/null || true
  networksetup -setproxyautodiscovery "$service" off 2>/dev/null || true
  echo "    $service: proxies off"
done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2)

# --- 4) ~/.docker/config.json (proxies do CLI) ---
DOCKER_CFG="$HOME/.docker/config.json"
if [[ -f "$DOCKER_CFG" ]] && grep -q '"proxies"' "$DOCKER_CFG" 2>/dev/null; then
  echo "==> Removendo proxies de ~/.docker/config.json..."
  cp "$DOCKER_CFG" "${DOCKER_CFG}.bak-proxy-$(date +%Y%m%d%H%M%S)"
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import json, os
path = os.path.expanduser("~/.docker/config.json")
with open(path) as f:
    data = json.load(f)
if "proxies" in data:
    del data["proxies"]
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print("    proxies removidos do config.json")
else:
    print("    (sem bloco proxies)")
PY
  else
    echo "    AVISO: python3 nao encontrado — edite manualmente ~/.docker/config.json"
  fi
else
  echo "==> ~/.docker/config.json sem bloco proxies (OK)"
fi

# --- 5) Mostrar estado ---
echo ""
echo "==> Estado Wi-Fi (se existir):"
networksetup -getwebproxy "Wi-Fi" 2>/dev/null || true
networksetup -getsecurewebproxy "Wi-Fi" 2>/dev/null || true

echo ""
echo "=============================================="
echo " Pronto."
echo " 1. Feche e abra o Docker Desktop (Quit + abrir de novo)"
echo " 2. Rode de novo:"
echo "    docker compose -f infra/docker/docker-compose.yml build --no-cache api worker"
echo "    docker compose -f infra/docker/docker-compose.yml up -d"
echo "=============================================="
echo ""
echo "Se ainda falhar com 45.79.x.x:8396:"
echo "  Docker Desktop -> Settings -> Proxies -> desligar Manual/System proxy"
