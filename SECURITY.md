# Documentação de Segurança

Este é um sistema estritamente administrativo e legítimo, que assiste motoristas
parceiros reais e autorizados no preenchimento de dados administrativos do próprio
cadastro. Ele **nunca** cria identidades falsas, envia documentos/selfies, acessa
câmera, resolve CAPTCHA/2FA, altera o provedor de verificação escolhido pela
plataforma, ou cancela/recria cadastros automaticamente - ao encontrar qualquer etapa
sensível, a automação para e devolve o controle a um operador humano.

## Princípios de segurança

### 1. Nunca salvar credenciais em texto plano

- Senhas de **operadores** (login no painel): hash bcrypt, nunca reversível
  (`packages/security/src/password.ts`).
- Credenciais de **e-mail** e **proxy** de cada motorista: criptografadas com
  AES-256-GCM antes de tocar o banco (`packages/security/src/encryption.ts` +
  `packages/credential-vault`). A chave mestra vem de um arquivo local
  (desenvolvimento) ou do AWS Secrets Manager (produção) - nunca fica hardcoded
  no código nem em variável de ambiente versionada.
- A senha de login da própria plataforma (Uber) usada por
  `UberDriverApplicationAdapter` (Fase 5) segue o mesmo modelo:
  `AutomationContext.platformCredential` é sempre um `EncryptedCredential`,
  descriptografado em memória só dentro de `LoginStep`, nunca logado.
- Código de verificação de e-mail: existe apenas em memória durante a chamada,
  nunca é persistido no banco; em auditoria aparece sempre mascarado (`****42`,
  ver `maskCode`).

### 2. Isolamento por empresa

- Toda query da API é filtrada por `company_id`, extraído do JWT do operador
  autenticado (`req.user.companyId`) - nunca de um parâmetro vindo do cliente.
  Isso vale igualmente para os endpoints novos da Fase 6
  (`pendingActions.service.ts`, `reports.service.ts`): cada `db.select()`
  inclui `eq(<tabela>.companyId, companyId)`.
- Um operador nunca consegue listar, ver o detalhe, resolver ou entregar a
  pendência de um motorista de outra empresa - a query já não retorna a linha.

### 3. Isolamento entre motoristas

- `BrowserProfileManager` (Fase 2) nunca reaproveita a sessão (cookies/
  localStorage) de um motorista para outro - diretório próprio por
  `applicantId`, com validação de integridade, obsolescência e bloqueio de
  segurança antes de qualquer reuso.
- Links de entrega da Central de Pendências (Fase 6) são específicos de um
  `applicantId` - o token não pode ser reaproveitado para acessar dados de
  outro motorista.

### 4. Logs sem dados sensíveis

- `AuditLogger` (`packages/security/src/auditLogger.ts`) mascara `metadata`
  por heurística de nome de campo **antes** de qualquer persistência - mesmo
  que uma rota esqueça de sanitizar um campo chamado `password`/`token`/
  `cookie`/`code`/`iv`/`authTag`/etc., ele nunca chega ao banco em texto puro.
  Isso é uma rede de segurança automática, não uma disciplina que cada
  desenvolvedor precisa lembrar de aplicar manualmente.
- Erros de descriptografia (`CredentialVault`) nunca incluem o texto puro nem
  o ciphertext/IV/authTag na mensagem de erro.

### 5. Autenticação obrigatória

- JWT de acesso (curta duração, `JWT_ACCESS_EXPIRES_IN`) + refresh token em
  cookie `httpOnly`/`secure` (produção)/`sameSite=strict`
  (`packages/security/src/jwt.ts`, `apps/api/src/routes/auth.routes.ts`).
- Toda rota da API exige `Authorization: Bearer <token>`, exceto:
  - `GET /health` (health check, não expõe dado nenhum).
  - `GET /api/openapi.json` e `/api/docs` (documentação estática da própria
    API).
  - `GET /api/deliveries/:token` - **intencionalmente pública**: quem acessa
    é o motorista (com o link entregue pelo operador), não um operador do
    painel. Protegida pela entropia do token (256 bits aleatórios, ver
    seção 7), não por login.
- Roles (`admin`/`operator`/`viewer`) controlam ações destrutivas/sensíveis
  via `requireRole(...)` - ex: só `admin`/`operator` podem resolver/cancelar
  uma pendência ou gerar um link de entrega; `viewer` só lê.

### 6. Rate limiting

- Login: máximo `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` (padrão 5) tentativas por
  janela de `LOGIN_RATE_LIMIT_WINDOW_MS` (padrão 15 min), por IP + e-mail
  (`apps/api/src/middleware/rateLimit.ts`).
- `GET /api/deliveries/:token` não tem rate limiting dedicado nesta versão -
  avaliado e considerado de baixo risco pela entropia do token (ver seção 7),
  mas é um candidato razoável para rate limiting adicional no futuro.

### 7. Auditoria completa

- Toda ação de operador relevante é registrada em `audit_logs`: login/logout,
  importações, teste de proxy, e (Fase 6) resolver/cancelar/assumir uma
  pendência e entregar um link ao motorista.
- Toda tentativa de automação (`apps/worker`) também é auditada: início,
  sucesso, pausa (`AWAITING_HUMAN_ACTION` + motivo categorizado), falha
  técnica com contagem de tentativas.
- A Central de Pendências expõe esse histórico por motorista em
  `GET /api/pending-actions/:id/audit-logs`.

## Links de entrega ao motorista (Fase 6) - modelo de ameaça

- O token é gerado com `crypto.randomBytes(32)` (256 bits de entropia) e
  codificado em base64url - não é adivinhável por força bruta.
- Só o **hash SHA-256** do token é armazenado (`driver_deliveries.token_hash`,
  mesmo padrão de token de reset de senha) - mesmo com acesso de leitura ao
  banco, não é possível reconstruir o token original.
- Todo link tem expiração obrigatória (60s a 7 dias, configurável por
  operador) - após expirar, `GET /api/deliveries/:token` retorna
  `status: 'EXPIRED'` e nenhuma informação adicional.
- A página pública (`apps/web/src/app/d/[token]/page.tsx`) nunca expõe mais
  que o primeiro nome do motorista, e nunca entrega uma sessão de
  navegador/automação ao vivo - apenas instruções para o motorista concluir a
  etapa pessoalmente no app/site oficial da plataforma.

## Checklist de segurança

- [x] Todas as senhas de operador hasheadas com bcrypt
- [x] Todas as credenciais de e-mail/proxy/plataforma criptografadas (AES-256-GCM)
- [x] Nenhuma senha em logs (mascaramento automático por `AuditLogger`)
- [x] Nenhum código de verificação completo em logs (`maskCode`, `****XX`)
- [x] Nenhuma credencial em resposta de API (`toPublicView`/testes dedicados,
      `apps/api/src/security.test.ts`)
- [x] Isolamento entre empresas (toda query filtrada por `company_id` do JWT)
- [x] Isolamento entre motoristas (`BrowserProfileManager`, sessões nunca
      compartilhadas)
- [x] Operador só vê dados da sua empresa (mesmo mecanismo do isolamento
      entre empresas - não há um papel "super-admin" cross-empresa)
- [x] Rate limiting ativo (login)
- [x] Auditoria ativa (`audit_logs`, cobrindo operador e worker)
- [ ] HTTPS em produção - **responsabilidade de quem faz o deploy**: os
      Dockerfiles/`docker-compose.yml` deste repositório não incluem TLS
      termination (não há certificado nem domínio para configurar aqui);
      normalmente resolvido por um load balancer/reverse proxy (ex: ALB,
      Caddy, nginx) na frente dos containers `api`/`web`.
- [ ] Backup automático do banco - **não implementado neste repositório**:
      `docker-compose.yml` usa um volume Docker nomeado (`postgres_data`)
      para persistência entre restarts, mas backup/restore programado
      (ex: `pg_dump` agendado, snapshots gerenciados) depende da
      infraestrutura de produção escolhida e está fora do escopo do código
      da aplicação.

## Limitações conhecidas (segurança e prontidão para produção)

- **Screenshot da etapa sensível** (`GET /api/pending-actions/:id/screenshot`,
  mencionada na Central de Pendências): o endpoint existe (contrato de API já
  fixado), mas sempre retorna 404 nesta versão - não há pipeline de captura
  (`page.screenshot()`) nem armazenamento sanitizado implementado. Exigiria
  primeiro conectar `apps/worker` a `UberDriverApplicationAdapter` (Fase 5),
  que ainda não está com a fila `automation-jobs` (ver "Próximos passos" no
  README).
- **Seletores CSS do site real da Uber**
  (`packages/platform-adapters/src/adapters/uber/selectors.ts`) e do Gmail
  (`packages/email-service/src/playwrightGmailClient.ts`) são a melhor
  suposição disponível, não puderam ser validados contra os sites reais
  neste ambiente de desenvolvimento - documentado nos respectivos módulos.
  Validar contra contas de teste descartáveis antes do primeiro uso real.
- **Envio de e-mail para o motorista** (mencionado no fluxo de entrega da
  Central de Pendências) não está implementado - o operador copia o link
  manualmente e o envia pelo canal de sua preferência. Ver README do painel
  (`apps/web`) e `DeliverToDriverModal.tsx`.
- **`pg.Pool` sem listener de erro era uma lacuna real** encontrada e
  corrigida nesta fase (`packages/database/src/client.ts`): sem ele, uma
  falha de conexão ociosa em segundo plano derrubava o processo Node inteiro
  (evento `error` sem handler é exceção não capturada). Corrigido com um
  listener que só loga o erro.
