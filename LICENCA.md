# Licenciamento GD Apps

Proteção por chave **`GD-XXXX-XXXX`** com servidor central em **https://automacao.gdapps.online**.

## Fluxo

1. Admin gera chave no painel (`automacao.gdapps.online`)
2. Cliente coloca `LICENSE_KEY=GD-...` no `.env` da instalação
3. API e worker fazem **activate** na subida + **heartbeat** a cada 15 min
4. Revogar no painel bloqueia a instalação no próximo heartbeat/job

## Painel admin

- URL: https://automacao.gdapps.online
- Login: usuário e senha definidos em `LICENSE_ADMIN_USER` / `LICENSE_ADMIN_PASSWORD` no servidor
- Ações: gerar chave, revogar, reativar, ver instalações (machine ID, hostname, último ping)

## Cliente (uber-automation)

Variáveis no `.env`:

```env
LICENSE_ENABLED=true
LICENSE_SERVER_URL=https://automacao.gdapps.online
LICENSE_KEY=GD-A7K2-9M4P
LICENSE_HEARTBEAT_MS=900000
```

Desenvolvimento local sem servidor: `LICENSE_ENABLED=false`.

## Deploy no VPS (2.24.124.218)

### 1. DNS

Aponte `automacao.gdapps.online` → `2.24.124.218`.

### 2. SSH

Gere chave local (se ainda não tiver):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gdapps_license -N ""
cat ~/.ssh/gdapps_license.pub
```

Adicione a chave pública em `/root/.ssh/authorized_keys` (ou usuário deploy) no VPS.

### 3. Subir serviços

No VPS:

```bash
cd /opt/uber-automation
cp infra/docker/.env.license.example infra/docker/.env.license
# Edite LICENSE_ADMIN_USER, LICENSE_ADMIN_PASSWORD e LICENSE_SESSION_SECRET
# Gere segredo: openssl rand -hex 32

docker compose -f infra/docker/docker-compose.license.yml --env-file infra/docker/.env.license up -d --build
```

Caddy obtém TLS Let's Encrypt automaticamente para `automacao.gdapps.online`.

### 4. Primeira chave

1. Abra https://automacao.gdapps.online
2. Entre com usuário e senha do `.env.license`
3. **Gerar chave** → copie `GD-XXXX-XXXX`
4. Coloque no `.env` de cada instalação cliente

## Desenvolvimento local do license-server

```bash
export LICENSE_ADMIN_USER=admin
export LICENSE_ADMIN_PASSWORD="dev-password-min-8"
export LICENSE_SESSION_SECRET="dev-session-secret-min-16-chars"
pnpm --filter @uber-automation/license-server dev
```

Painel: http://localhost:8090

## Estrutura

| Pacote / app | Função |
|---|---|
| `packages/license-shared` | Formato GD-XXXX-XXXX, tipos |
| `packages/license-client` | activate, heartbeat, guard |
| `apps/license-server` | API + painel admin (SQLite) |
