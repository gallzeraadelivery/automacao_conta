#!/bin/bash
# Clique duplo: corrige Unexpected server error no login (migrate + seed admin).
cd "$(dirname "$0")"
bash scripts/fix-admin-login-mac.sh
STATUS=$?
echo
if [[ $STATUS -ne 0 ]]; then
  echo "Falhou (codigo $STATUS)."
fi
read -r -p "Pressione Enter para fechar..."
exit $STATUS
