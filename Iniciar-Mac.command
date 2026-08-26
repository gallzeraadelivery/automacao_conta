#!/bin/bash
# Clique duas vezes neste arquivo no Finder para iniciar o painel em janela.
cd "$(dirname "$0")"
chmod +x scripts/start-mac.sh Iniciar-Mac.command 2>/dev/null || true
./scripts/start-mac.sh
STATUS=$?
if [[ $STATUS -ne 0 ]]; then
  echo
  echo "Falhou (código $STATUS). Leia a mensagem acima."
  echo "Pressione Enter para fechar…"
  read -r _
fi
exit $STATUS
