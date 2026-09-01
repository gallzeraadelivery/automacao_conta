#!/usr/bin/env bash
# Deploy do servidor de licenças no VPS (automacao.gdapps.online)
set -euo pipefail

HOST="${LICENSE_VPS_HOST:-2.24.124.218}"
USER="${LICENSE_VPS_USER:-root}"
REMOTE_DIR="${LICENSE_VPS_DIR:-/opt/uber-automation}"

echo "==> Deploy license-server → ${USER}@${HOST}:${REMOTE_DIR}"

if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "${USER}@${HOST}" "echo SSH OK"; then
  echo ""
  echo "ERRO: sem acesso SSH. Adicione sua chave pública no VPS:"
  echo "  cat ~/.ssh/id_ed25519.pub   # ou ~/.ssh/gdapps_license.pub"
  echo "  # no VPS: echo '...' >> ~/.ssh/authorized_keys"
  exit 1
fi

ssh "${USER}@${HOST}" "mkdir -p ${REMOTE_DIR}"

rsync -avz --delete \
  --exclude node_modules --exclude .git --exclude storage --exclude .env \
  ./ "${USER}@${HOST}:${REMOTE_DIR}/"

ssh "${USER}@${HOST}" bash -s <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
if [[ ! -f infra/docker/.env.license ]]; then
  cp infra/docker/.env.license.example infra/docker/.env.license
  echo "Crie LICENSE_ADMIN_TOKEN em infra/docker/.env.license no VPS"
  exit 1
fi
docker compose -f infra/docker/docker-compose.license.yml --env-file infra/docker/.env.license up -d --build
docker compose -f infra/docker/docker-compose.license.yml ps
EOF

echo "==> Painel: https://automacao.gdapps.online"
