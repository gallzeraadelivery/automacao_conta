#!/bin/bash
cd "$(dirname "$0")"
bash scripts/fix-imap-tls-mac.sh
STATUS=$?
echo
read -r -p "Pressione Enter para fechar..."
exit $STATUS
