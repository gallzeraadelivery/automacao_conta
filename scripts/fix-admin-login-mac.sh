#!/usr/bin/env bash
# Corrige login "Unexpected server error" / admin nao entra:
# roda migrate + recria admin@example.com / admin123 no Postgres do Docker.
#
# Uso:
#   bash scripts/fix-admin-login-mac.sh
#   # ou clique duplo: CORRIGIR-Login-Admin-Mac.command

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE="infra/docker/docker-compose.yml"
EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}"
PASSWORD="${SEED_ADMIN_PASSWORD:-admin123}"
PGUSER="${POSTGRES_USER:-uber_automation}"
PGDB="${POSTGRES_DB:-uber_automation}"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  # carrega so POSTGRES_* se existirem (evita poluir demais)
  # shellcheck disable=SC2046
  eval "$(grep -E '^(POSTGRES_USER|POSTGRES_DB)=' .env | sed 's/\r$//' || true)"
  set +a
  PGUSER="${POSTGRES_USER:-uber_automation}"
  PGDB="${POSTGRES_DB:-uber_automation}"
fi

echo "==> Uber Automation - corrigir login admin"
echo "    Pasta: $ROOT"
echo "    Email: $EMAIL"
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "ERRO: Docker nao esta rodando. Abra o Docker Desktop e tente de novo."
  exit 1
fi

if [[ ! -f "$COMPOSE" ]]; then
  echo "ERRO: nao achei $COMPOSE"
  exit 1
fi

echo "==> Garantindo containers..."
docker compose -f "$COMPOSE" up -d
docker compose -f "$COMPOSE" ps

echo "==> Aguardando API / postgres..."
for i in $(seq 1 40); do
  if docker compose -f "$COMPOSE" exec -T postgres pg_isready -U "$PGUSER" >/dev/null 2>&1; then
    break
  fi
  sleep 2
  if [[ "$i" -eq 40 ]]; then
    echo "ERRO: postgres nao ficou pronto"
    exit 1
  fi
done

echo "==> Migrando banco..."
docker compose -f "$COMPOSE" exec -T api \
  pnpm --filter @uber-automation/database db:migrate

echo "==> Recriando admin ($EMAIL)..."
# Idempotente: apaga o operador e cria de novo com a senha padrao
SAFE_EMAIL="${EMAIL//\'/\'\'}"
docker compose -f "$COMPOSE" exec -T postgres \
  psql -U "$PGUSER" -d "$PGDB" \
  -c "DELETE FROM operators WHERE lower(email) = lower('${SAFE_EMAIL}');" \
  >/dev/null 2>&1 || true

docker compose -f "$COMPOSE" exec -T \
  -e "SEED_ADMIN_EMAIL=$EMAIL" \
  -e "SEED_ADMIN_PASSWORD=$PASSWORD" \
  api pnpm --filter @uber-automation/database db:seed

echo ""
echo "=============================================="
echo " Login corrigido."
echo " Painel: http://localhost:3000/login"
echo " Email:  $EMAIL"
echo " Senha:  $PASSWORD"
echo "=============================================="
