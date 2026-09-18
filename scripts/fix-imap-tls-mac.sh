#!/usr/bin/env bash
# Liga IMAP_TLS_REJECT_UNAUTHORIZED=false neste Mac (Spacemail / certificado).
# Nao mexe no padrao dos outros PCs — so neste .env local.
#
# Uso: bash scripts/fix-imap-tls-mac.sh
#      ou clique: CORRIGIR-Imap-Tls-Mac.command

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE="infra/docker/docker-compose.yml"

echo "==> Uber Automation - corrigir TLS do IMAP (Mac)"
echo "    Pasta: $ROOT"
echo ""

if [[ ! -f .env ]]; then
  echo "ERRO: .env nao encontrado. Rode INSTALAR primeiro."
  exit 1
fi

if grep -qE '^[[:space:]]*IMAP_TLS_REJECT_UNAUTHORIZED=' .env; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' -E 's/^[[:space:]]*IMAP_TLS_REJECT_UNAUTHORIZED=.*/IMAP_TLS_REJECT_UNAUTHORIZED=false/' .env
  else
    sed -i -E 's/^[[:space:]]*IMAP_TLS_REJECT_UNAUTHORIZED=.*/IMAP_TLS_REJECT_UNAUTHORIZED=false/' .env
  fi
  echo "==> IMAP_TLS_REJECT_UNAUTHORIZED=false (atualizado)"
else
  printf '\n# Spacemail TLS incompleto neste Mac\nIMAP_TLS_REJECT_UNAUTHORIZED=false\n' >> .env
  echo "==> IMAP_TLS_REJECT_UNAUTHORIZED=false (adicionado)"
fi

if ! docker info >/dev/null 2>&1; then
  echo "AVISO: Docker parado — abra o Docker e rode:"
  echo "  docker compose -f $COMPOSE up -d --build api worker"
  exit 0
fi

echo "==> Rebuild api+worker (pega o codigo novo + env)..."
docker compose -f "$COMPOSE" up -d --build api worker

echo ""
echo "Pronto. Retente o job do motorista."
echo "Para voltar ao modo seguro neste Mac, remova a linha IMAP_TLS_REJECT_UNAUTHORIZED do .env"
