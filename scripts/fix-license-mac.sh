#!/usr/bin/env bash
# Corrige worker/API com "Chave de licenca invalida" mesmo apos ativar no painel.
# - Comenta LICENSE_KEY no .env (storage/license.key tem prioridade no codigo novo)
# - Garante pasta storage/
# - Reinicia api + worker
#
# Uso:
#   bash scripts/fix-license-mac.sh
#   # ou clique: CORRIGIR-Licenca-Mac.command
#
# Depois: abra http://localhost:3000/licenca e ative a chave UMA vez se ainda
# nao existir storage/license.key

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE="infra/docker/docker-compose.yml"

echo "==> Uber Automation - corrigir licenca (Mac)"
echo "    Pasta: $ROOT"
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "ERRO: Docker nao esta rodando. Abra o Docker Desktop."
  exit 1
fi

mkdir -p storage

if [[ -f .env ]]; then
  if grep -qE '^[[:space:]]*LICENSE_KEY=' .env; then
    BAK=".env.bak-license-$(date +%Y%m%d%H%M%S)"
    cp .env "$BAK"
    # Comenta linhas LICENSE_KEY ativas (mantem historico)
    if [[ "$(uname -s)" == "Darwin" ]]; then
      sed -i '' -E 's/^([[:space:]]*LICENSE_KEY=)/# \1/' .env
    else
      sed -i -E 's/^([[:space:]]*LICENSE_KEY=)/# \1/' .env
    fi
    echo "==> LICENSE_KEY comentada no .env (backup: $BAK)"
  else
    echo "==> .env sem LICENSE_KEY ativa (OK)"
  fi

  if ! grep -qE '^[[:space:]]*LICENSE_SERVER_URL=' .env; then
    echo 'LICENSE_SERVER_URL=https://automacao.gdapps.online' >> .env
    echo "==> LICENSE_SERVER_URL adicionado"
  fi
else
  echo "AVISO: .env nao encontrado — rode INSTALAR primeiro"
fi

echo "==> storage/license.key:"
if [[ -f storage/license.key ]]; then
  KEY="$(tr -d '[:space:]' < storage/license.key)"
  if [[ ${#KEY} -ge 8 ]]; then
    echo "    presente: ${KEY:0:3}-****-****"
  else
    echo "    presente mas curto/vazio — ative de novo no painel"
  fi
else
  echo "    AUSENTE — depois deste script, ative em http://localhost:3000/licenca"
fi

echo "==> Reiniciando api + worker..."
docker compose -f "$COMPOSE" up -d api worker
docker compose -f "$COMPOSE" restart api worker

echo "==> Aguardando..."
sleep 5
echo ""
echo "==> Log worker (licenca):"
docker compose -f "$COMPOSE" logs worker --tail 25 2>/dev/null | grep -iE 'license|licenca|Worker ready' || \
  docker compose -f "$COMPOSE" logs worker --tail 25

echo ""
echo "=============================================="
echo " Se ainda aparecer 'Chave de licenca invalida':"
echo " 1. Abra http://localhost:3000/licenca e ative a chave GD-..."
echo " 2. Confira: cat storage/license.key"
echo " 3. docker compose -f $COMPOSE restart api worker"
echo "=============================================="
