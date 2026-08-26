#!/bin/bash
# Clique duas vezes neste arquivo no Finder para INSTALAR o sistema (1ª vez).
# O instalador chama `sudo` sozinho e pede a senha 1x se faltar Docker.
cd "$(dirname "$0")"
chmod +x scripts/install-mac.sh scripts/start-mac.sh Iniciar-Mac.command INSTALAR-Mac.command 2>/dev/null || true
echo "Uber Automation — instalação"
echo "Se faltar Docker, o script vai pedir sudo (senha do Mac) uma vez."
echo
./scripts/install-mac.sh
echo
echo "Pressione Enter para fechar…"
read -r _
