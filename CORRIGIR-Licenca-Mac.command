#!/bin/bash
cd "$(dirname "$0")"
bash scripts/fix-license-mac.sh
STATUS=$?
echo
if [[ $STATUS -ne 0 ]]; then
  echo "Falhou (codigo $STATUS)."
fi
read -r -p "Pressione Enter para fechar..."
exit $STATUS
