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
- Docker Compose para desenvolvimento local (PostgreSQL + Redis + api + web + worker)

## Fase 2 — o que já existe

- **CredentialVault** (`packages/credential-vault`): implementa `ICredentialVault`
  (encrypt/decrypt/delete/auditAccess), com a chave mestra vindo do AWS Secrets Manager
  ou de um arquivo local `.secrets.key` (nunca de código-fonte). Toda a API (import de
  e-mails, CRUD de proxies) e o worker passam por ele - nada mais chama AES-256-GCM
  diretamente.
- **AuditLogger** (`packages/security`): `log()`/`maskSensitiveData()` genéricos,
  independentes de banco - qualquer `metadata` é mascarado automaticamente antes de
  persistir (senha, token, cookie, código, IV/authTag nunca chegam ao sink em texto
  puro). Funções `maskCode`, `maskEmail`, `maskPhone`. `apps/api` e `apps/worker`
  injetam um sink que grava em `audit_logs` (`createDatabaseAuditLogSink`, em
  `packages/database`).
- **BrowserProfileManager** (`packages/automation`): isolamento estrito de sessão por
  motorista (`storage/browser-profiles/applicant-{id}/{uber,gmail}/...`), com
  validação (e-mail/proxy associado, integridade dos arquivos, sessão obsoleta,
  bloqueio de segurança) antes de qualquer reuso.
- **EmailVerificationWorker** (`packages/email-service`): acessa o Gmail do motorista
  via Playwright para localizar o código de confirmação, com filtro inteligente
  (remetente, assunto, janela de tempo, não repete código já usado) e parada imediata
  em 2FA/CAPTCHA/confirmação de telefone. O código nunca é persistido - só existe em
  memória durante a chamada.
- **Fila `automation-jobs`** (`apps/worker`): limites de concorrência por
  empresa/proxy/e-mail/motorista (5/2/1/1) via semáforo no Redis, backoff progressivo
  (1s/5s/15s, até 3 tentativas), e separação clara entre erros técnicos (retentáveis) e
  erros que exigem humano (CAPTCHA, bloqueio, 2FA, verificação de identidade etc. -
  nunca retentados automaticamente).

## Estrutura

```
uber-automation/
├── apps/
│   ├── web/        # Painel administrativo (Next.js)
│   ├── api/         # Backend REST (Express)
│   └── worker/       # Worker BullMQ (fila automation-jobs)
├── packages/
│   ├── database/              # Schemas Drizzle, migrations, client, sink de auditoria
│   ├── security/               # bcrypt, AES-256-GCM, JWT, AuditLogger, mascaramento
│   ├── credential-vault/        # ICredentialVault + AWS Secrets Manager / arquivo local
│   ├── shared/                  # Tipos e validação (zod) compartilhados
│   ├── proxy-manager/            # Teste de conectividade de proxy
│   ├── automation/                # BrowserProfileManager (sessões isoladas)
│   ├── email-service/              # EmailVerificationWorker (Gmail via Playwright)
│   ├── verification-detector/       # (stub — Fase 4+)
│   └── platform-adapters/            # (stub — Fase 3+, preenchimento do form Uber)
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
   openssl rand -hex 32   # -> JWT_ACCESS_SECRET
   openssl rand -hex 32   # -> JWT_REFRESH_SECRET

   # Chave mestra do CredentialVault (desenvolvimento local, SECRETS_PROVIDER=local):
   openssl rand -hex 32 > .secrets.key   # nunca commite este arquivo
   ```

   Em desenvolvimento, se `.secrets.key` não existir, o CredentialVault cai de volta
   para `CREDENTIAL_ENCRYPTION_KEY` no `.env` - defina um dos dois. Veja a seção
   "Configuração do CredentialVault" mais abaixo para o fluxo recomendado em produção
   (AWS Secrets Manager).

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

96 testes, nenhum exige Postgres/Redis reais (usam fakes/mocks injetados via DI - ver
`packages/*/src/**/*.test.ts` e `apps/*/src/**/*.test.ts`). Cobrem:

- Validações de importação (`packages/shared`): email inválido, duplicidade no arquivo,
  campos obrigatórios vazios, `proxy_id` malformado.
- Autenticação/autorização da API (`apps/api`): rotas protegidas sem token, payload
  inválido antes de tocar o banco.
- **Segurança (Fase 2)**: senha nunca aparece em log/erro/exceção
  (`credentialVault.test.ts`, `emailVerificationWorker.test.ts`), código de verificação
  sempre mascarado em auditoria (`****XX`, nunca completo), mascaramento genérico não
  reidenticando falsos positivos (`auditLogger.test.ts`), API nunca retorna
  host/senha/IV/authTag de proxy ou colunas de credencial de e-mail
  (`apps/api/src/security.test.ts` - verifica isso via `toSQL()`, sem precisar de um
  Postgres real), isolamento de sessão entre motoristas
  (`browserProfileManager.test.ts`), pausa (não repete) em 2FA/CAPTCHA
  (`emailVerificationWorker.test.ts`, `processor.test.ts`), limites de concorrência e
  backoff da fila (`concurrencyLimiter.test.ts`, `processor.test.ts`).

Validações que dependem do banco (duplicidade já existente na empresa, proxy
inexistente, e-mail já associado a outro motorista) são testadas na camada de serviço da
API contra um Postgres real; suba `docker compose up -d postgres` antes de rodar testes
de integração adicionais que você queira escrever sobre essa camada.

## Configuração do CredentialVault (Fase 2)

O `CredentialVault` (`packages/credential-vault`) nunca lê a chave mestra do
código-fonte. Duas opções, controladas por `SECRETS_PROVIDER`:

### `local` (padrão - desenvolvimento)

```bash
openssl rand -hex 32 > .secrets.key
```

`SECRETS_KEY_FILE_PATH` aponta para esse arquivo (padrão: `.secrets.key` na raiz do
projeto). Se o arquivo não existir, cai de volta para a variável
`CREDENTIAL_ENCRYPTION_KEY` do `.env` (mesmo comportamento da Fase 1) - útil para CI,
mas evite isso fora de desenvolvimento local. **Nunca commite `.secrets.key`** (já está
no `.gitignore`).

### `aws` (recomendado em produção)

1. Gere a chave e publique-a no AWS Secrets Manager (o segredo deve conter os 64
   caracteres hex da chave, mesmo formato de `CREDENTIAL_ENCRYPTION_KEY`):

   ```bash
   aws secretsmanager create-secret \
     --name uber-automation/credential-vault-key \
     --secret-string "$(openssl rand -hex 32)"
   ```

2. Configure no `.env` (ou nas variáveis de ambiente do serviço em produção):

   ```bash
   SECRETS_PROVIDER=aws
   AWS_SECRETS_MANAGER_SECRET_ID=uber-automation/credential-vault-key
   AWS_REGION=us-east-1
   ```

3. A aplicação usa a cadeia padrão de credenciais da AWS SDK (variáveis de ambiente
   `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, IAM role da instância/task, etc.) - não
   há nada específico deste projeto para configurar além do `SecretId`. A permissão IAM
   mínima necessária é `secretsmanager:GetSecretValue` restrita a esse segredo.

A chave é buscada uma vez e cacheada em memória pelo processo (API/worker) - trocar o
valor no Secrets Manager exige reiniciar o processo para ser aplicado (não há hot-reload
de chave).

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
  criação de `browser_profiles`.
- **AuditLogger** (`packages/security`) mascara `metadata` por heurística de nome de
  campo antes de qualquer persistência - mesmo que uma rota esqueça de sanitizar um
  campo chamado `password`/`token`/`cookie`/`code`/`iv`/`authTag`/etc., ele nunca chega
  ao banco em texto puro. Campos já pré-mascarados pelo chamador (`maskedCode`,
  `maskedPhone`) passam intactos (convenção de prefixo `masked`).
- **CredentialVault**: `encrypt`/`decrypt` auditam cada acesso
  (`credential_encrypt`/`credential_decrypt`/`credential_decrypt_failed`), nunca
  incluindo o texto puro nem o ciphertext/IV/authTag na mensagem de erro em caso de
  falha na decriptação.
- **BrowserProfileManager**: um motorista nunca reaproveita a sessão de outro (diretório
  próprio por `applicantId`); ao reutilizar uma sessão existente, valida e-mail/proxy
  associados, integridade dos arquivos, obsolescência (padrão: 30 dias) e ausência de
  bloqueio de segurança (arquivo `LOCK` gravado quando o Gmail apresenta 2FA/CAPTCHA).
- **EmailVerificationWorker**: para imediatamente (nunca tenta resolver) ao detectar
  2FA, CAPTCHA ou confirmação de telefone no Gmail, marca a conta de e-mail como
  `requires_human_action` e bloqueia o perfil de navegador. O código de verificação
  existe apenas em memória durante a chamada - nunca é persistido no banco; nos logs de
  auditoria aparece sempre mascarado (`****42`). **Limitação conhecida**: os seletores
  de UI do Gmail em `PlaywrightGmailClient` não puderam ser validados contra o Gmail
  real neste ambiente (login automatizado real tende a disparar a própria detecção de
  bot da Google - exatamente o cenário em que o worker deve pausar, não contornar).
  Valide contra uma conta de teste descartável antes de produção; a Gmail API via
  OAuth 2.0 (comentada no fim de `playwrightGmailClient.ts`) é a alternativa
  recomendada a médio prazo por não depender de scraping de UI.
- **Fila `automation-jobs`**: limites de concorrência (5 por empresa, 2 por proxy, 1 por
  conta de e-mail, 1 por motorista) via semáforo atômico no Redis
  (`apps/worker/src/concurrencyLimiter.ts`) - BullMQ open-source não tem grupos de
  concorrência nativos (isso é recurso pago do BullMQ Pro). Backoff progressivo
  1s/5s/15s, máximo 3 tentativas. Erros são classificados em `TechnicalAutomationError`
  (retentável) e `NonRetryableAutomationError`/`SecurityChallengeError` (nunca
  retentado - o job é descartado via `job.discard()` e o motorista passa para
  `AWAITING_HUMAN_ACTION`, que já aparece no dashboard/listagem existentes).

## Próximos passos (Fase 3+)

Consulte as fases seguintes conforme forem detalhadas. A Fase 3 deve implementar as
etapas de preenchimento do formulário da Uber em `packages/platform-adapters` (hoje um
stub) e conectá-las à fila `automation-jobs` (hoje só executa o passo
`AWAIT_EMAIL_CODE`).
