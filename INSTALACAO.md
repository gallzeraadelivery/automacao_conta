# Instalação — Uber Automation (painel em janela)

O painel administrativo abre em uma **janela própria** (Electron), não no Chrome/Safari.  
A API, o worker e o banco continuam no **Docker**, do mesmo jeito que já funciona hoje.

## O que você precisa

| Item | Mac | Windows |
|------|-----|---------|
| Docker Desktop | Sim | Sim |
| Node.js 20+ | Sim (só para a janela do painel) | Sim |
| pnpm | Instalado automaticamente pelos scripts | Idem |

Baixe o Docker Desktop se ainda não tiver:  
https://www.docker.com/products/docker-desktop/

## Instalação automática

### MacBook (macOS)

No Terminal, na pasta do projeto:

```bash
chmod +x scripts/install-mac.sh Iniciar-Mac.command scripts/start-mac.sh
./scripts/install-mac.sh
```

O script:

1. Verifica/ajuda a instalar Docker e Node  
2. Cria `.env` e `.secrets.key` se faltarem  
3. Roda `pnpm install`  
4. Sobe o stack: `docker compose -f infra/docker/docker-compose.yml up -d --build`  
5. Tenta migrate + seed do admin  

### Windows

No PowerShell, na pasta do projeto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows.ps1
```

Mesmos passos do Mac (Docker + `.env` + compose + seed).

## Como abrir o painel (janela)

| Sistema | Inicializador |
|---------|----------------|
| **Mac** | Clique duas vezes em `Iniciar-Mac.command` |
| **Windows** | Clique duas vezes em `Iniciar-Windows.bat` |

Ou no terminal:

```bash
# Mac
./scripts/start-mac.sh

# Windows (PowerShell)
.\scripts\start-windows.ps1
```

Isso sobe os containers (se estiverem parados) e abre a janela do painel em `http://localhost:3000`.

## Login padrão (após seed)

- E-mail: `admin@example.com`  
- Senha: `admin123`  

(Se você definiu `SEED_ADMIN_*` no ambiente, use esses valores.)

## Comandos manuais (igual ao fluxo atual)

Se preferir sem os scripts:

```bash
cp .env.example .env
openssl rand -hex 32 > .secrets.key   # Mac/Linux

docker compose -f infra/docker/docker-compose.yml up -d --build

pnpm install
pnpm db:migrate
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=admin123 pnpm db:seed

pnpm --filter @uber-automation/desktop-shell start
```

## Parar tudo

```bash
docker compose -f infra/docker/docker-compose.yml down
```

Feche a janela do painel normalmente (Cmd+Q / Alt+F4).

## Problemas comuns

| Sintoma | O que fazer |
|---------|-------------|
| “Docker não está rodando” | Abra o **Docker Desktop** e espere o status Running |
| Janela diz “painel offline” | Espere o `web` subir: `docker compose -f infra/docker/docker-compose.yml logs -f web` |
| Porta 3000/4000 ocupada | Pare outro serviço ou mude `WEB_PORT` / `API_PORT` no `.env` e rebuild o web |
| Mac: `Iniciar-Mac.command` não executa | No Terminal: `chmod +x Iniciar-Mac.command` |
| Windows: script bloqueado | `Set-ExecutionPolicy -Scope Process Bypass` e rode de novo |

## Arquivos desta melhoria

- `apps/desktop-shell/` — app Electron (janela do painel)  
- `scripts/install-mac.sh` / `scripts/install-windows.ps1` — instalação automática  
- `scripts/start-mac.sh` / `scripts/start-windows.ps1` — sobe stack + abre janela  
- `Iniciar-Mac.command` / `Iniciar-Windows.bat` — atalho de clique duplo  
