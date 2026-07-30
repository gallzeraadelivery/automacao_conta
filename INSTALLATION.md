# Guia de Instalação

## Pré-requisitos

- Docker e Docker Compose (recomendado)
- Node.js 20+ e pnpm 9+ (`corepack enable` habilita o pnpm certo automaticamente) - só
  necessário para desenvolvimento local sem Docker
- PostgreSQL 16+ e Redis 7+ (se não usar Docker)

## Instalação com Docker (recomendado)

1. Clone o repositório.

2. Copie `.env.example` para `.env` e preencha os valores reais:

   ```bash
   cp .env.example .env
   openssl rand -hex 32   # -> JWT_ACCESS_SECRET
   openssl rand -hex 32   # -> JWT_REFRESH_SECRET
   openssl rand -hex 32   # -> CREDENTIAL_ENCRYPTION_KEY
   ```

   Ajuste `POSTGRES_PASSWORD` para uma senha forte própria (nunca use o valor de
   exemplo em produção). Veja "Configuração de Segredos" abaixo para o fluxo
   recomendado em produção.

3. Suba a aplicação (Postgres, Redis, API, worker e painel web):

   ```bash
   docker compose -f infra/docker/docker-compose.yml up --build
   ```

   O simulador local da Uber (`apps/mock-server`, Fase 3 - **nunca use em produção**)
   não sobe por padrão. Para incluí-lo (ex: para testar a automação sem tocar a
   plataforma real):

   ```bash
   docker compose -f infra/docker/docker-compose.yml --profile dev up --build
   ```

4. Rode as migrations (a primeira vez, com os containers já no ar):

   ```bash
   docker compose -f infra/docker/docker-compose.yml exec api pnpm --filter @uber-automation/database db:migrate
   ```

   Ou rode localmente contra o Postgres exposto pelo Docker (porta `POSTGRES_PORT`,
   padrão 5432): `pnpm db:migrate`.

5. Crie o operador administrador inicial:

   ```bash
   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=ChangeMe123! pnpm db:seed
   ```

6. Acesse `http://localhost:${WEB_PORT:-3000}/login`.

### Sobre a imagem do painel web (Next.js)

`NEXT_PUBLIC_API_URL` é embutida no bundle do cliente **durante o build da imagem**
Docker (`docker compose build`), não lida em tempo de execução. Se você mudar essa
variável no `.env`, precisa rebuildar a imagem do `web` (`docker compose build web`)
para que o painel passe a apontar para a nova URL da API - reiniciar o container sem
rebuildar não é suficiente. Veja `infra/docker/Dockerfile.web` para os detalhes.

### Sobre a imagem do worker

O worker inclui um Chromium real (Playwright) para a automação de navegador
(`packages/email-service`, `packages/platform-adapters`) - a imagem é
proporcionalmente maior que as demais por causa disso; é esperado.

## Instalação Local (sem Docker)

1. Instale as dependências:

   ```bash
   pnpm install
   ```

2. Suba Postgres e Redis localmente (ou via Docker, só esses dois serviços):

   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d postgres redis
   ```

3. Configure banco de dados:

   ```bash
   pnpm db:migrate
   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=ChangeMe123! pnpm db:seed
   ```

4. Inicie o backend, o frontend e o worker (em terminais separados):

   ```bash
   pnpm dev:api      # http://localhost:4000
   pnpm dev:web      # http://localhost:3000
   pnpm dev:worker
   pnpm dev:mock     # http://localhost:3001 - simulador Uber (Fase 3), opcional
   ```

## Configuração de Segredos

### AWS Secrets Manager (recomendado em produção)

1. Crie um secret no AWS Secrets Manager contendo os 64 caracteres hex da chave de
   criptografia (mesmo formato de `CREDENTIAL_ENCRYPTION_KEY`): `openssl rand -hex 32`.
2. Configure no `.env` (ou nas variáveis de ambiente do serviço em produção):

   ```bash
   SECRETS_PROVIDER=aws
   AWS_SECRETS_MANAGER_SECRET_ID=uber-automation/credential-vault-key
   AWS_REGION=us-east-1
   ```

3. A aplicação usa a cadeia padrão de credenciais da AWS SDK (variáveis de ambiente,
   IAM role da instância/task, etc.). Permissão IAM mínima: `secretsmanager:GetSecretValue`
   restrita a esse segredo.

### Local (desenvolvimento)

1. Gere a chave: `openssl rand -hex 32 > .secrets.key` (nunca versione esse arquivo -
   já está no `.gitignore`).
2. Deixe `SECRETS_PROVIDER=local` (padrão) e `SECRETS_KEY_FILE_PATH=.secrets.key` no
   `.env`. Se o arquivo não existir, o sistema cai de volta para
   `CREDENTIAL_ENCRYPTION_KEY` do `.env`.

## Documentação da API

Com a API no ar, a documentação interativa (Swagger UI) fica em
`http://localhost:${API_PORT:-4000}/api/docs` (spec bruta em `/api/openapi.json`,
fonte em `apps/api/openapi.yaml`).

## Verificando a instalação

```bash
curl http://localhost:4000/health          # {"success":true,"data":{"status":"ok"}}
curl http://localhost:4000/api/openapi.json | head -c 100
```

Rode a suíte de testes completa (não depende de Postgres/Redis reais, exceto quando
explicitamente indicado - ver README "Testes"):

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Próximos passos após a instalação

Veja a seção "Próximos passos" do [README.md](./README.md) principal - inclui a
lista do que ainda depende de configuração/validação específica do seu ambiente
(seletores da Uber/Gmail contra contas reais, TLS, backup do banco, etc., também
detalhado em [SECURITY.md](./SECURITY.md)).
