#!/bin/bash
# Clique duas vezes neste arquivo no Finder para INSTALAR o sistema (1ª vez).
# Pode pedir a senha de administrador 1x (Docker Desktop).
cd "$(dirname "$0")"
chmod +x scripts/install-mac.sh scripts/start-mac.sh Iniciar-Mac.command INSTALAR-Mac.command 2>/dev/null || true
echo "Uber Automation — instalação"
echo "Se o Mac pedir senha de administrador, é normal (Docker)."
echo
./scripts/install-mac.sh
echo
echo "Pressione Enter para fechar…"
read -r _
