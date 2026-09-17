#!/bin/bash
# Clique duplo: desliga proxy HTTP do Mac/Docker que quebra o build.
cd "$(dirname "$0")"
bash scripts/fix-docker-proxy-mac.sh
echo
read -r -p "Pressione Enter para fechar..."
