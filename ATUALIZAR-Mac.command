#!/bin/bash
# Clique duas vezes para ATUALIZAR o sistema (git pull + rebuild Docker).
cd "$(dirname "$0")"
chmod +x scripts/update-mac.sh ATUALIZAR-Mac.command 2>/dev/null || true
echo "Uber Automation — atualizar (pull + rebuild worker/api/web)"
echo
./scripts/update-mac.sh
STATUS=$?
echo
if [[ $STATUS -ne 0 ]]; then
  echo "Falhou (código $STATUS)."
fi
echo "Pressione Enter para fechar…"
read -r _
exit $STATUS
