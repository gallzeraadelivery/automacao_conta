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

## Instalação rápida (janela nativa, Mac/Windows)

O painel abre em **janela própria** (não no navegador). Guia completo:

→ **[INSTALACAO.md](./INSTALACAO.md)**

```bash
# Mac
./scripts/install-mac.sh
# depois: clique em Iniciar-Mac.command  (ou ./scripts/start-mac.sh)

# Windows (PowerShell)
.\scripts\install-windows.ps1
# depois: clique em Iniciar-Windows.bat  (ou .\scripts\start-windows.ps1)
```

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

## Fase 3 — o que já existe

- **Mock Uber server** (`apps/mock-server`, porta 3001): páginas HTML que simulam o
  fluxo de cadastro da Uber (login → formulário administrativo → verificação de e-mail
  → uma de 8 etapas terminais) para testar a automação sem tocar a plataforma real.
  Cobre os cenários: foto de perfil (Socure / outro provedor / desconhecido), CNH
  (Socure / outro provedor), CAPTCHA, 2FA e bloqueio de segurança. As páginas terminais
  não têm nenhum caminho funcional de bypass (botões desabilitados ou inertes) - servem
  para validar que a automação **para** corretamente, nunca para simular que ela
  "resolve" essas etapas. Veja a seção [Mock Uber server](#mock-uber-server-fase-3)
  mais abaixo.

## Fase 4 — o que já existe

- **VerificationFlowDetector** (`packages/verification-detector`): módulo
  **exclusivamente informativo** que identifica qual provedor de verificação está
  sendo apresentado (Socure, outro provedor nomeado, provedor genérico não
  catalogado, a própria Uber, ou desconhecido) a partir de URL, domínio, título,
  texto visível, atributos HTML, nomes de script e recursos carregados - nunca
  interage com, contorna ou influencia a verificação em si. Também classifica
  páginas de desafio (CAPTCHA/2FA/bloqueio de segurança) como uma categoria distinta
  de "página de verificação de identidade". Validado com **100% de acerto (8/8)**
  contra o HTML real de todos os cenários da Fase 3 (não fixtures escritas à mão) -
  ver [`packages/verification-detector/README.md`](./packages/verification-detector/README.md)
  e o [relatório de precisão](./packages/verification-detector/ACCURACY_REPORT.md).

## Fase 5 — o que já existe

- **UberDriverApplicationAdapter** (`packages/platform-adapters`): navega pelo
  login e formulário administrativo do cadastro de motorista parceiro da Uber,
  resolve o código de verificação por e-mail (Fase 2) e **para imediatamente**
  ao encontrar qualquer etapa sensível (foto de perfil, CNH, CAPTCHA, 2FA,
  bloqueio de segurança) - identificada de forma puramente informativa via o
  `VerificationFlowDetector` (Fase 4) - entregando a sessão para o motorista
  concluir pessoalmente. URLs/timeouts (`config.ts`) e seletores CSS
  (`selectors.ts`) ficam totalmente separados da lógica de automação
  (`steps/*.ts`), para que uma mudança de layout da Uber nunca exija tocar em
  lógica. Validado com **100% de acerto (8/8)** nos cenários da Fase 3,
  executando o adaptador real com um **Chromium headless real** (não só lendo
  HTML) contra `apps/mock-server` - ver
  [`packages/platform-adapters/README.md`](./packages/platform-adapters/README.md)
  e o [relatório de testes](./packages/platform-adapters/TEST_REPORT.md).

## Fase 6 — o que já existe

- **Central de Pendências** (`/dashboard/pending-actions`): tela onde operadores veem
  motoristas com `status = AWAITING_HUMAN_ACTION` (não é uma tabela nova - é uma visão
  sobre `applicants`, a mesma fonte da verdade já atualizada pelo worker desde a Fase 2)
  com motivo da pausa, provedor/confiança detectados (Fase 4), operador responsável e
  ações: **resolver**, **cancelar**, **assumir para revisão** e **entregar ao
  motorista** (gera um link seguro de curta duração - nunca uma sessão de automação ao
  vivo, ver [SECURITY.md](./SECURITY.md)). Endpoints em `apps/api/src/routes/pendingActions.routes.ts`
  e `deliveries.routes.ts` (a rota pública que o motorista acessa).
- **Dashboards e relatórios**: dashboard principal ampliado com taxa de sucesso e
  gráfico de status; `Relatório de Automação` (taxa de sucesso, tempo médio,
  distribuição de provedor, principais erros técnicos) e `Relatório de Auditoria`
  (ações por tipo/operador, eventos de segurança), ambos com gráficos (`recharts`) e
  exportação em **CSV e PDF** (`apps/api/src/routes/reports.routes.ts`).
- **Documentação da API**: OpenAPI 3.0 completo (`apps/api/openapi.yaml`), servido via
  Swagger UI em `/api/docs` (spec bruta em `/api/openapi.json`).
- **Docker de produção**: Dockerfiles multi-stage (usuário não-root, healthcheck,
  `next build --output=standalone` para o painel, Chromium real no worker); ver
  [INSTALLATION.md](./INSTALLATION.md). `apps/mock-server` (Fase 3) só sobe com
  `docker compose --profile dev up` - nunca em um `docker compose up` simples.
- **[SECURITY.md](./SECURITY.md)**: checklist de segurança e modelo de ameaça dos
  links de entrega ao motorista. **[INSTALLATION.md](./INSTALLATION.md)**: guia de
  instalação (Docker e local).

## Estrutura

```
uber-automation/
├── apps/
│   ├── web/        # Painel administrativo (Next.js)
│   ├── api/         # Backend REST (Express)
│   ├── worker/       # Worker BullMQ (fila automation-jobs)
│   └── mock-server/   # Simulador local do fluxo de cadastro da Uber (Fase 3)
├── packages/
│   ├── database/              # Schemas Drizzle, migrations, client, sink de auditoria
│   ├── security/               # bcrypt, AES-256-GCM, JWT, AuditLogger, mascaramento
│   ├── credential-vault/        # ICredentialVault + AWS Secrets Manager / arquivo local
│   ├── shared/                  # Tipos e validação (zod) compartilhados
│   ├── proxy-manager/            # Teste de conectividade de proxy
│   ├── automation/                # BrowserProfileManager (sessões isoladas)
│   ├── email-service/              # EmailVerificationWorker (Gmail via Playwright)
│   ├── verification-detector/       # VerificationFlowDetector (deteção informativa de provedor)
│   └── platform-adapters/            # UberDriverApplicationAdapter (login, formulário, e-mail, pausa em etapa sensível)
├── infra/docker/    # Dockerfiles (produção, multi-stage) e docker-compose.yml
├── SECURITY.md       # Checklist de segurança e modelo de ameaça (Fase 6)
└── INSTALLATION.md    # Guia de instalação - Docker e local (Fase 6)
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
   pnpm dev:mock     # http://localhost:3001 - simulador Uber (Fase 3), opcional
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

180 testes, nenhum exige Postgres/Redis reais (usam fakes/mocks injetados via DI - ver
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
- **Mock Uber server (Fase 3)** (`apps/mock-server/src/app.test.ts`): fluxo completo
  login → formulário → e-mail → cenário terminal, roteamento por `?scenario=`, as 8
  páginas terminais respondem 200 com o `data-testid` esperado, CAPTCHA/2FA/bloqueio
  nunca têm um controle habilitado (sem bypass funcional), Socure e o outro provedor
  são claramente distinguíveis e a página "desconhecido" nunca identifica nenhum dos
  dois.
- **VerificationFlowDetector (Fase 4)** (`packages/verification-detector`): 15 testes
  com fixtures realistas (não o markup do nosso próprio mock, para provar que
  generaliza) cobrindo Socure/concorrente nomeado/desconhecido/Uber interna, sinal
  forte nunca perdendo para sinal fraco conflitante; mais 9 testes de integração que
  buscam o HTML real do `apps/mock-server` via `supertest` e rodam o detector contra
  ele - inclui os 8 cenários da Fase 4 e a página de login (nunca classificada como
  verificação/desafio).
- **UberDriverApplicationAdapter (Fase 5)** (`packages/platform-adapters`): 12 testes
  rodando o adaptador real com um **Chromium headless real** (via Playwright) contra
  `apps/mock-server` numa porta efêmera - preenche formulários e clica em botões de
  verdade, não só lê HTML. Cobre os 8 cenários da Fase 3 (foto de perfil e CNH:
  Socure/outro provedor/desconhecido; CAPTCHA; 2FA; bloqueio de segurança - sempre
  pausando, nunca resolvendo/contornando), a progressão de `currentStep` no fluxo
  completo, conclusão (`SUCCESS`) quando nenhuma etapa sensível é encontrada, e
  tratamento de erro (não uma exceção crua) quando a credencial de login está
  corrompida.
- **Central de Pendências e relatórios (Fase 6)** (`apps/api`): parsing real de
  arquivos CSV/XLSX (`parseSpreadsheet.test.ts` - inclui um bug de codificação
  UTF-8 encontrado e corrigido nesta fase, que corrompia nomes acentuados como
  "João"), geração de CSV/PDF (`csv.test.ts`, `pdf.test.ts`), hash do token de
  entrega ao motorista nunca reversível/nunca reutilizável
  (`pendingActions.hashToken.test.ts`), autenticação obrigatória e validação de
  entrada acontecendo antes de qualquer consulta ao banco em todas as rotas novas
  (`pendingActions.test.ts`, `reports.test.ts`).

Validações que dependem do banco (duplicidade já existente na empresa, proxy
inexistente, e-mail já associado a outro motorista) são testadas na camada de serviço da
API contra um Postgres real; suba `docker compose up -d postgres` antes de rodar testes
de integração adicionais que você queira escrever sobre essa camada.

## Mock Uber server (Fase 3)

Servidor Express local (`apps/mock-server`, porta padrão `3001`) que simula o fluxo de
cadastro de motorista parceiro da Uber, para testar a automação sem qualquer risco de
afetar contas reais. **Não é uma cópia da Uber real** - é uma ferramenta de teste com
páginas próprias, claramente marcadas como "AMBIENTE DE TESTE".

```bash
pnpm dev:mock   # http://localhost:3001
```

### Fluxo

```
/mock-uber/login              (aceita qualquer e-mail/senha)
  -> /mock-uber/application    (formulário administrativo)
  -> /mock-uber/email-verification   (código de 6 dígitos - exibido na tela,
                                       banner "MODO TESTE", nunca em produção)
  -> /mock-uber/next-step      (redireciona para o cenário configurado)
```

O cenário final é escolhido via `?scenario=<nome>` em qualquer página do fluxo (fica
salvo na sessão) e também pode ser acessado diretamente, sem passar pelo fluxo, para
testar uma página isolada:

| Cenário                 | URL direta                         | O que simula                                          |
| ----------------------- | ---------------------------------- | ----------------------------------------------------- |
| `photo-socure` (padrão) | `/mock-uber/profile-photo-socure`  | Foto de perfil via Socure                             |
| `photo-other`           | `/mock-uber/profile-photo-other`   | Foto de perfil via outro provedor ("Verificador XYZ") |
| `photo-unknown`         | `/mock-uber/profile-photo-unknown` | Foto de perfil, provedor não identificável            |
| `license-socure`        | `/mock-uber/driver-license-socure` | CNH via Socure                                        |
| `license-other`         | `/mock-uber/driver-license-other`  | CNH via outro provedor                                |
| `captcha`               | `/mock-uber/captcha`               | CAPTCHA                                               |
| `2fa`                   | `/mock-uber/two-factor`            | Autenticação em duas etapas (SMS)                     |
| `block`                 | `/mock-uber/security-block`        | Bloqueio de segurança / atividade suspeita            |

Exemplo - testar o cenário de CAPTCHA do zero:

```
http://localhost:3001/mock-uber/login?scenario=captcha
```

Ou visitar a página terminal diretamente, sem passar pelo login:

```
http://localhost:3001/mock-uber/captcha
```

### Garantias das páginas terminais (photo-_, license-_, captcha, 2fa, security-block)

- **Nenhuma tem um caminho funcional de avanço automático.** Os campos/botões de
  CAPTCHA e 2FA são `disabled` no HTML; os botões de selfie/upload das páginas de
  foto/CNH não enviam nada a lugar nenhum (apenas realçam a mensagem "complete esta
  etapa pessoalmente"); a página de bloqueio não tem nenhum `<form>`. Isso é
  verificado em `apps/mock-server/src/app.test.ts`.
- **Socure vs. outro provedor são claramente distinguíveis** (`data-provider`,
  nome do provedor visível, script simulado próprio) - a página "desconhecido" nunca
  menciona nenhum dos dois nomes, propositalmente, para exercitar o caminho de
  "provedor não identificado" do `packages/verification-detector`.
- Nenhum script carrega de um domínio de terceiros real - `socure.com` e
  `verificador-xyz.com` são apenas comentários/atributos `data-simulated-domain`; os
  arquivos JS de fato servidos são locais (`public/fake-sdk/*.fake.js`).
- O código de verificação de e-mail é gerado aleatoriamente por sessão e exibido na
  própria tela (banner "MODO TESTE") e via `GET /mock-uber/__test__/state` - só nesta
  ferramenta de teste; nunca é assim em produção.

### Identificadores para automação (Playwright)

Todo elemento relevante tem `data-testid` estável (`login-form`, `login-email`,
`application-submit`, `email-verification-code`, `provider-name`, `human-required-message`
etc.) e as páginas terminais expõem `data-step-type` e `data-provider` no card
principal - use esses seletores em vez de texto visível, que pode mudar.

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
- **Central de Pendências (Fase 6)**: não é uma tabela nova - é uma visão sobre
  `applicants` filtrada por `status = 'AWAITING_HUMAN_ACTION'` (evita duplicar
  estado; o status já é a fonte da verdade). Novas colunas (`pause_reason`,
  `paused_at`, `*_confidence`) só armazenam categorias/timestamps, nunca dado
  sensível - o detalhe legível continua no log de auditoria correspondente.
- **Link de entrega ao motorista (Fase 6)**: token de 256 bits
  (`crypto.randomBytes(32)`), só o hash SHA-256 vai para o banco
  (`driver_deliveries.token_hash`), expiração obrigatória, e a página pública
  que o motorista acessa nunca entrega uma sessão de automação ao vivo -
  apenas instruções para ele concluir a etapa pessoalmente na plataforma real.
  Ver [SECURITY.md](./SECURITY.md) para o modelo de ameaça completo.
- **`pg.Pool` sem listener de `error`** (`packages/database/src/client.ts`) era uma
  lacuna real de robustez encontrada nesta fase: sem ele, uma falha de conexão
  ociosa em segundo plano (evento `error` do Node sem handler) derrubava o
  processo inteiro. Corrigido com um listener que apenas loga o erro.
- **`node dist/index.js` nunca funcionou** para `apps/api`/`apps/worker`/
  `apps/mock-server` (verificado manualmente nesta fase - `ERR_MODULE_NOT_FOUND`,
  porque os pacotes do workspace exportam `main` apontando para TypeScript fonte
  e os imports relativos do projeto não têm extensão `.js`). Os scripts `start`
  desses três apps foram corrigidos para rodar via `tsx` (mesmo motor de
  desenvolvimento, sem watch/hot-reload) - ver comentário no topo de
  `infra/docker/Dockerfile.api`/`Dockerfile.worker` para os detalhes e o que
  seria necessário para compilar de verdade (`NodeNext` + extensões explícitas
  em todo o monorepo, ou um bundler).

## Próximos passos

O sistema está funcional ponta a ponta (base, workers seguros, ambiente de testes,
detecção de provedor, adaptador Uber, painel administrativo, deploy containerizado),
mas os itens abaixo dependem de validação/decisão específica do seu ambiente antes de
um primeiro uso real com motoristas de verdade:

1. **Conectar `UberDriverApplicationAdapter` (Fase 5) à fila `automation-jobs`**
   (`apps/worker`, hoje só executa o passo `AWAIT_EMAIL_CODE`): abrir um navegador
   real por `browserProfileId` (via `BrowserProfileManager`, que já isola
   sessão/cookies por motorista), instanciar o adaptador com esse `Page`, e mapear
   `AutomationResult.pauseReason` diretamente para `NonRetryableAutomationError`
   (`apps/worker/src/errors.ts`) - os valores já foram desenhados para bater 1:1,
   sem tradução. Sem essa conexão, a Central de Pendências (Fase 6) só mostra
   motoristas que chegaram a `AWAITING_HUMAN_ACTION` por outro caminho (ex: dados
   de teste inseridos manualmente).
2. **Validar os seletores reais** contra contas de teste descartáveis: Uber
   (`packages/platform-adapters/src/adapters/uber/selectors.ts`) e Gmail
   (`packages/email-service/src/playwrightGmailClient.ts`) - documentados como não
   validados contra os sites reais neste ambiente de desenvolvimento.
3. **Pipeline de screenshot sanitizada** para a Central de Pendências (endpoint já
   existe, sempre 404 nesta versão - ver SECURITY.md) - depende do item 1 (só faz
   sentido capturar uma screenshot durante uma automação de verdade).
4. **Envio automático do link de entrega por e-mail/SMS** (hoje o operador copia e
   envia manualmente - ver `DeliverToDriverModal.tsx`).
5. **TLS/HTTPS e backup automático do banco em produção** - fora do escopo do
   código da aplicação, depende da infraestrutura escolhida (ver checklist em
   [SECURITY.md](./SECURITY.md)).
6. **Migrar para módulos compilados de verdade** (`NodeNext` + extensões `.js`
   explícitas, ou um bundler) se o custo de start-up do `tsx` em produção deixar
   de ser aceitável em algum momento - ver nota acima sobre `node dist/index.js`.
