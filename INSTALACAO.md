# Instalação — Uber Automation (painel em janela)

O painel administrativo abre em uma **janela própria** (Electron), não no Chrome/Safari.  
A API, o worker e o banco continuam no **Docker**, do mesmo jeito que já funciona hoje.

## O que você precisa

Na prática: só clicar em **INSTALAR-…**. O script tenta instalar sozinho:

| Item | Mac | Windows |
|------|-----|---------|
| Homebrew | Só se Docker ainda não existir (pede senha 1x) | — |
| Docker Desktop | Instala + abre e espera (**pode pedir senha de admin**) | Instala via **winget** + abre e espera |
| Node.js 20+ | **nvm no usuário (sem sudo)** | Instala LTS via **winget** |
| pnpm | Via corepack/npm do usuário | Via corepack / npm |

**Mac — senha de administrador:** o instalador chama **`sudo` sozinho** no começo se faltar Docker/Homebrew e pede a senha **uma vez**. Não dá para gravar a senha no script (segurança do macOS). Node/pnpm não usam sudo.

**Windows:** na 1ª instalação do Docker pode pedir **WSL2** e/ou **reiniciar o PC** — depois rode `INSTALAR-Windows.bat` de novo.

## Instalação automática

### MacBook (macOS)

1. Clique duas vezes em **`INSTALAR-Mac.command`**  
   (ou no Terminal: `./scripts/install-mac.sh`)

2. Depois, para abrir o painel em janela: clique em **`Iniciar-Mac.command`**

### Windows

1. Clique duas vezes em **`INSTALAR-Windows.bat`**  
   (ou no PowerShell: `.\scripts\install-windows.ps1`)

2. Depois, para abrir o painel em janela: clique em **`Iniciar-Windows.bat`**

Os instaladores fazem:

1. Instalam o que faltar (Homebrew/Docker/Node no Mac; Docker/Node via winget no Windows)  
2. Esperam o Docker Desktop ficar Running  
3. Criam `.env` e `.secrets.key` se faltarem  
4. Rodam `pnpm install`  
5. Sobe o stack: `docker compose -f infra/docker/docker-compose.yml up -d --build`  
6. Tentam migrate + seed do admin  

## Como abrir o painel (janela)

| Sistema | Instalar (1ª vez) | Abrir painel |
|---------|-------------------|--------------|
| **Mac** | `INSTALAR-Mac.command` | `Iniciar-Mac.command` |
| **Windows** | `INSTALAR-Windows.bat` | `Iniciar-Windows.bat` |

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
| Mac: `INSTALAR-Mac.command` / `Iniciar-Mac.command` não executa | No Terminal: `chmod +x INSTALAR-Mac.command Iniciar-Mac.command` |
| Windows: script bloqueado | Clique em `INSTALAR-Windows.bat` (já usa Bypass); ou `Set-ExecutionPolicy -Scope Process Bypass` |

## Arquivos desta melhoria

- `apps/desktop-shell/` — app Electron (janela do painel)  
- `INSTALAR-Mac.command` / `INSTALAR-Windows.bat` — instalação com clique duplo  
- `Iniciar-Mac.command` / `Iniciar-Windows.bat` — abrir painel com clique duplo  
- `scripts/install-mac.sh` / `scripts/install-windows.ps1` — instalação automática  
- `scripts/start-mac.sh` / `scripts/start-windows.ps1` — sobe stack + abre janela  
