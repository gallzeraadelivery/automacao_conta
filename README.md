# uber-automation

Sistema de automação **assistida** para preenchimento administrativo de cadastros de
motoristas parceiros. O sistema preenche apenas dados administrativos (nome, email,
telefone, endereço, CEP, tipo de veículo) e recupera códigos de confirmação no Gmail do
motorista. **Ele para imediatamente ao encontrar qualquer etapa sensível** (foto de
perfil, CNH, verificação facial, prova de vida, CAPTCHA, 2FA), registra o provedor de
verificação detectado e entrega a sessão para o motorista concluir pessoalmente.

Este repositório nunca deve conter lógica que crie identidades falsas, envie
documentos/selfies, acesse câmera, resolva CAPTCHA/2FA, troque o provedor de verificação
escolhido pela plataforma, ou cancele/recrie cadastros automaticamente.

## Fase 1 — o que já existe

- Monorepo pnpm (`apps/*`, `packages/*`)
- Banco de dados PostgreSQL modelado com Drizzle ORM (migrations em
  `packages/database/migrations`)
- Autenticação de operadores (JWT access + refresh token via cookie httpOnly)
- API REST (Express) para importação de motoristas/e-mails e CRUD de proxies
- Painel administrativo (Next.js) com login, dashboard, importação e gerenciamento de
  proxies
- Worker BullMQ (esqueleto, sem lógica de automação — chega na Fase 3+)
- Docker Compose para desenvolvimento local (PostgreSQL + Redis + api + web + worker)

## Estrutura

```
uber-automation/
├── apps/
│   ├── web/        # Painel administrativo (Next.js)
│   ├── api/         # Backend REST (Express)
│   └── worker/       # Worker BullMQ (esqueleto)
├── packages/
│   ├── database/              # Schemas Drizzle, migrations, client
│   ├── security/               # bcrypt, AES-256-GCM, JWT
│   ├── credential-vault/        # Camada de criptografia de credenciais
│   ├── shared/                  # Tipos e validação (zod) compartilhados
│   ├── proxy-manager/            # Teste de conectividade de proxy
│   ├── automation/                # (stub — Fase 3+)
│   ├── email-service/              # (stub — Fase 3+)
│   ├── verification-detector/       # (stub — Fase 4+)
│   └── platform-adapters/            # (stub — Fase 3+)
└── infra/docker/    # Dockerfiles e docker-compose.yml
```

## Pré-requisitos

- Node.js 20+ e pnpm 9+ (`corepack enable` habilita o pnpm certo automaticamente)
- Docker + Docker Compose (para Postgres/Redis locais)

## Setup local

1. Instale as dependências:

   ```bash
   pnpm install
   ```

2. Copie o arquivo de variáveis de ambiente e gere segredos fortes:

   ```bash
   cp .env.example .env
   # Gere valores aleatórios para os segredos:
   openssl rand -hex 32   # -> CREDENTIAL_ENCRYPTION_KEY (32 bytes = 64 chars hex)
   openssl rand -hex 32   # -> JWT_ACCESS_SECRET
   openssl rand -hex 32   # -> JWT_REFRESH_SECRET
   ```

3. Suba o PostgreSQL e o Redis:

   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d postgres redis
   ```

4. Rode as migrations e crie o operador admin inicial:

   ```bash
   pnpm db:migrate
   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=ChangeMe123! pnpm db:seed
   ```

5. Suba a API, o painel web e o worker (em terminais separados, ou via Docker):

   ```bash
   pnpm dev:api      # http://localhost:4000
   pnpm dev:web      # http://localhost:3000
   pnpm dev:worker
   ```

   Ou tudo via Docker Compose:

   ```bash
   docker compose -f infra/docker/docker-compose.yml up --build
   ```

6. Acesse `http://localhost:3000/login` com o e-mail/senha do seed.

## Testes

```bash
pnpm test
```

Cobre principalmente as validações de importação (`packages/shared`) e a camada de
autenticação/autorização da API (`apps/api`) — email inválido, e-mail/`external_id`
duplicado no arquivo, campos obrigatórios vazios, `proxy_id` malformado, rotas
protegidas sem token, criptografia AES-256-GCM (round-trip e detecção de adulteração).

Validações que dependem do banco (duplicidade já existente na empresa, proxy
inexistente, e-mail já associado a outro motorista) são testadas na camada de serviço da
API contra um Postgres real; suba `docker compose up -d postgres` antes de rodar testes
de integração adicionais que você queira escrever sobre essa camada.

## Decisões de segurança relevantes

- Senhas de operadores: bcrypt (`packages/security`).
- Credenciais de e-mail e de proxy: AES-256-GCM (`packages/security` +
  `packages/credential-vault`), nunca retornadas em texto puro pela API.
- `proxy_configs` tem um único par `(encryption_iv, encryption_auth_tag)` por linha.
  Reutilizar esse par para criptografar `host`, `username` e `password`
  separadamente quebraria a garantia de segurança do AES-GCM (o par IV+chave não pode
  ser reaproveitado para textos diferentes). Por isso host+username+password são
  serializados em um único blob JSON e criptografados de uma vez só, armazenado em
  `host_encrypted`; as colunas `username_encrypted`/`password_encrypted` ficam
  reservadas (são nullable no schema). Isso significa que a API nunca expõe o host de
  um proxy via GET — apenas protocolo, porta, região, status e latência.
- Rate limiting no login (`LOGIN_RATE_LIMIT_*` no `.env`).
- Isolamento por empresa: toda query da API é filtrada por `company_id` extraído do JWT.
- Log de auditoria (`audit_logs`) para login/logout, importações e testes de proxy —
  nunca inclui senhas, tokens ou códigos de verificação.
- A coluna `proxy_id` no arquivo de importação de motoristas é opcional e serve apenas
  para validar antecipadamente se o proxy existe (a tabela `applicants` do schema
  fornecido não tem coluna de proxy); a vinculação efetiva a um proxy acontece na
  criação de `browser_profiles`, a partir da Fase 3.

## Próximos passos (Fase 2+)

Consulte as fases seguintes conforme forem detalhadas.
