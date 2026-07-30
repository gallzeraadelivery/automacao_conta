# @uber-automation/platform-adapters

Adaptadores de automação específicos de plataforma - hoje, o fluxo de cadastro
de motorista parceiro da Uber (`UberDriverApplicationAdapter`). Navega pelo
login e pelo formulário administrativo, resolve o código de verificação por
e-mail (`@uber-automation/email-service`, Fase 2) e **para imediatamente**
assim que encontra qualquer etapa sensível (foto de perfil, CNH, CAPTCHA,
2FA, bloqueio de segurança) - identificada de forma puramente informativa via
`@uber-automation/verification-detector` (Fase 4) - entregando a sessão para
o motorista concluir pessoalmente.

## ⚠️ O que este adaptador nunca faz

Por regra de segurança obrigatória deste projeto, `UberDriverApplicationAdapter`:

- **Nunca** envia documentos, selfies ou fotos, nem preenche um `<input type="file">`.
- **Nunca** acessa ou simula câmera/webcam, nem tenta prova de vida.
- **Nunca** resolve CAPTCHA nem contorna 2FA - apenas detecta e pausa.
- **Nunca** conclui uma verificação de identidade, seja qual for o provedor
  detectado (Socure, outro provedor, ou desconhecido) - a decisão de "seguir
  em frente" nunca é automática nessas etapas.
- **Nunca** altera ou solicita um provedor de verificação diferente do que a
  própria plataforma escolheu.
- **Nunca** cancela e recria um cadastro automaticamente.

Se alguma dessas ações fosse necessária para "completar" o fluxo, a resposta
correta é sempre pausar e devolver o controle para um humano - nunca
implementar um contorno. É exatamente isso que `ProfilePhotoStep`,
`DriverLicenseStep` e o roteamento de CAPTCHA/2FA/bloqueio em
`UberDriverApplicationAdapter.continueAdministrativeSteps` fazem.

## Uso

```ts
import { chromium } from "playwright";
import { UberDriverApplicationAdapter } from "@uber-automation/platform-adapters";
import { EmailVerificationWorker } from "@uber-automation/email-service";
import { CredentialVault } from "@uber-automation/credential-vault";

// `page` normalmente vem de um contexto de navegador já isolado por
// motorista (ver @uber-automation/automation BrowserProfileManager, que
// gerencia o diretório de sessão/cookies - este pacote não abre o navegador
// nem gerencia perfis, apenas recebe uma `Page` já pronta).
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const adapter = new UberDriverApplicationAdapter(page, {
  emailWorker: new EmailVerificationWorker(/* ... */),
  vault: new CredentialVault(/* ... */),
  // config/selectors são opcionais - por padrão usam UBER_CONFIG/UBER_SELECTORS
  // (o site real da Uber). Só passe algo diferente para apontar para outro
  // ambiente (ex: testes contra apps/mock-server - ver seção de testes abaixo).
});

const result = await adapter.start({
  applicantId: "applicant-1",
  browserProfileId: "profile-1",
  emailAccountId: "email-1",
  proxyId: "proxy-1",
  companyId: "company-1",
  applicantData: {
    fullName: "João da Silva",
    email: "joao.silva@example.com",
    phone: "11999998888",
    address: "Rua das Flores, 123",
    city: "São Paulo",
    state: "SP",
    postalCode: "01310-100",
    vehicleType: "sedan",
  },
  // Senha de login da Uber, já criptografada via CredentialVault - nunca em
  // texto puro (ver "Desvios deliberados do briefing" abaixo).
  platformCredential: await vault.encrypt("senha-do-motorista", { applicantId: "applicant-1" }),
});

switch (result.status) {
  case "SUCCESS":
    // Cadastro administrativo concluído nesta sessão, sem nenhuma etapa
    // sensível encontrada (ex: uma página de "cadastro em análise").
    break;
  case "VERIFICATION_DETECTED":
  case "PAUSED":
    // Etapa sensível ou desafio detectado - result.pauseReason e
    // result.verificationDetected explicam o motivo. Acionar intervenção
    // humana (ex: notificar o motorista, marcar o cadastro como
    // "aguardando ação humana" - ver apps/worker/src/errors.ts).
    break;
  case "ERROR":
    // Falha técnica (timeout, seletor não encontrado, credencial inválida).
    // result.error.code/message - normalmente retryable pelo chamador.
    break;
}
```

## Arquitetura

```
src/
├── index.ts                 # API pública do pacote
├── types.ts                 # IPlatformAdapter, AutomationContext/Result, sinais internos de controle
├── base/
│   └── PlatformAdapter.ts   # ciclo de vida genérico (status, currentStep, tradução de exceções)
└── adapters/
    ├── types.ts              # StepContext<TConfig, TSelectors> - o que cada step recebe
    ├── errorMapping.ts        # erro cru do Playwright -> AutomationTechnicalError com código estável
    └── uber/
        ├── UberDriverApplicationAdapter.ts   # orquestra os steps, roteia por tipo de página
        ├── config.ts                          # URLs e timeouts (baseUrl, endpoints, maxContinueClicks)
        ├── selectors.ts                        # seletores CSS (documentados um a um)
        ├── mockUberConfig.ts                    # config/seletores para testes contra apps/mock-server (não exportado publicamente)
        ├── pageIntrospection.ts                  # captura url/html/scripts/resources da página atual
        └── steps/
            ├── LoginStep.ts
            ├── ApplicationFormStep.ts
            ├── EmailVerificationStep.ts
            ├── ProfilePhotoStep.ts    # detecta e SEMPRE pausa - nunca envia nada
            ├── DriverLicenseStep.ts   # detecta e SEMPRE pausa - nunca envia nada
            ├── CompletionStep.ts      # registra conclusão quando nenhuma etapa sensível é encontrada
            └── verificationPause.ts   # decide o AutomationPauseReason a partir do ProviderClassification
```

Cada step é uma função pura recebendo um `StepContext` (página, config,
seletores, dependências) - nenhum estado é guardado nos steps em si, só na
classe do adaptador (`currentStep`/`status`). Isso permite testar cada step
isoladamente e trocar `config`/`selectors` sem tocar em nenhuma lógica.

### Como o adaptador decide o que fazer em cada página

Depois de verificar o e-mail, `continueAdministrativeSteps` entra num loop
(limitado por `config.maxContinueClicks`, padrão 8, para nunca travar em loop
infinito) que classifica a página atual via
`classifyPageType` (`@uber-automation/verification-detector`, Fase 4):

| `classifyPageType` retorna                  | Ação                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROFILE_PHOTO`                             | `ProfilePhotoStep` - identifica o provedor (informativo) e **sempre pausa**                                                                  |
| `DRIVER_LICENSE`                            | `DriverLicenseStep` - identifica o provedor (informativo) e **sempre pausa**                                                                 |
| `CAPTCHA` / `TWO_FACTOR` / `SECURITY_BLOCK` | Pausa imediatamente, `provider: 'UNKNOWN'`, `confidence: 'HIGH'`                                                                             |
| `UNKNOWN`                                   | Tenta clicar num botão "Continuar" genérico; se não encontrar nenhum, assume que o cadastro terminou (`CompletionStep`, `status: 'SUCCESS'`) |

## Configuração (URLs e seletores)

`config.ts` (`UBER_CONFIG`) e `selectors.ts` (`UBER_SELECTORS`) concentram
tudo que depende do layout específico da Uber - a lógica de automação nos
`steps/*.ts` nunca tem uma URL ou seletor hardcoded. Cada seletor em
`selectors.ts` tem um comentário explicando o que ele identifica.

### Como atualizar quando a Uber mudar o layout

Edite apenas `selectors.ts` (ou `config.ts` para URLs/timeouts) - nenhum step
precisa mudar:

```ts
// Antes
emailInput: 'input[name="email"]',
// Depois
emailInput: 'input[id="user-email"]',
```

Campos que podem ser `<input>` ou `<select>` (ex: estado, tipo de veículo)
usam `FieldSelector { selector, kind: 'fill' | 'select' }` em vez de uma
string simples - `ApplicationFormStep` escolhe `page.fill`/`page.selectOption`
automaticamente a partir de `kind`, sem precisar de nenhum `if` específico de
campo.

### Como adicionar suporte a outra plataforma (não-Uber)

1. Crie `src/adapters/<plataforma>/` com a mesma estrutura (`config.ts`,
   `selectors.ts`, `steps/`, `<Plataforma>Adapter.ts`).
2. Estenda `PlatformAdapter` (`src/base/PlatformAdapter.ts`) - ele já cuida
   de status/currentStep/tradução de `AutomationPauseSignal`/
   `AutomationTechnicalError` em `AutomationResult`.
3. Reaproveite `StepContext<TConfig, TSelectors>` (`src/adapters/types.ts`),
   `toTechnicalError` (`src/adapters/errorMapping.ts`) e o
   `VerificationFlowDetector` (Fase 4) - nenhum deles é específico da Uber.
4. As mesmas regras de segurança obrigatórias se aplicam: nunca enviar
   documento/selfie, nunca resolver CAPTCHA/2FA, sempre pausar em etapa
   sensível.

### Como adicionar suporte a um novo provedor de verificação

Isso não é feito aqui - `@uber-automation/verification-detector` (Fase 4) já
detecta provedores não catalogados via padrões genéricos (`data-provider`,
"Powered by X"). Para reconhecer o **nome/domínio** de um provedor
específico com alta confiança, edite
`packages/verification-detector/src/providerRegistry.ts` - este pacote não
precisa de nenhuma mudança.

## Desvios deliberados do briefing

- **`AutomationContext.platformCredential`** (não estava no briefing): o
  exemplo de `login()` do briefing usa uma senha hardcoded
  (`'temp-password'`), mas não existe nenhum lugar de onde uma senha real
  viria. Seguindo o mesmo modelo já usado para contas de e-mail (Fase 2), a
  senha de login da Uber trafega **sempre criptografada**
  (`EncryptedCredential` do `@uber-automation/credential-vault`) e só é
  descriptografada em memória, dentro de `LoginStep`, nunca logada.
- **`AutomationResult.verificationDetected.type`** foi ampliado para incluir
  `'CAPTCHA' | 'TWO_FACTOR' | 'SECURITY_BLOCK'` além de
  `'PROFILE_PHOTO' | 'DRIVER_LICENSE'` - o próprio pseudocódigo do briefing
  usa esses valores em `detectVerificationStep`, mas a interface `AutomationResult`
  só declarava os dois primeiros.
- **`AutomationResult.pauseReason`** (não estava no briefing): motivo
  estruturado da pausa (`AutomationPauseReason`), escolhido para bater 1:1
  com o subconjunto relevante de `NonRetryableReason` já definido em
  `apps/worker/src/errors.ts` (Fase 2) - quando o worker passar a chamar
  este adaptador, o valor pode ser usado diretamente para construir um
  `NonRetryableAutomationError`, sem tradução.
- **Toda etapa sensível pausa, independente do provedor detectado**: o
  pseudocódigo do briefing só lança `VERIFICATION_DETECTED` quando
  `result.provider !== 'UNKNOWN'`, o que deixaria a foto de perfil/CNH
  seguir em frente automaticamente quando o provedor não pôde ser
  identificado - exatamente o caso em que mais se precisa de uma pausa
  (menos confiança = mais cautela, não menos). Esta implementação sempre
  pausa em `PROFILE_PHOTO`/`DRIVER_LICENSE`, e usa o provedor só para
  categorizar o **motivo** da pausa (`pauseReasonForProvider` em
  `steps/verificationPause.ts`), nunca para decidir se pausa.
- **Sem `endpoints.profilePhoto`/`driverLicense`/`completion`** em
  `config.ts`: o adaptador nunca navega diretamente para essas páginas (a
  URL de destino depende de qual etapa/provedor a própria Uber decidir
  apresentar) - ele só clica em botões "Continuar" genéricos e observa onde
  o fluxo o deixa.

## Testes

```bash
pnpm --filter @uber-automation/platform-adapters test
```

12 testes em `src/uberDriverApplicationAdapter.test.ts`, rodando o adaptador
real com um **Chromium headless real** (via Playwright) contra
`apps/mock-server` (Fase 3) real numa porta efêmera - mesma técnica usada
pelos testes de integração do `verification-detector` (Fase 4), agora também
preenchendo formulários e clicando em botões de verdade, não só lendo HTML.
Cobre:

- Fluxo completo (login → formulário → e-mail → etapa terminal reconhecida).
- Detecção de foto de perfil: Socure, outro provedor, desconhecido.
- Detecção de CNH: Socure, outro provedor.
- Detecção de CAPTCHA, 2FA e bloqueio de segurança - sempre pausando, nunca
  tentando resolver/contornar.
- Conclusão (`SUCCESS`) quando nenhuma etapa sensível é encontrada - com um
  double mínimo de `Page` (ver "Limitações conhecidas" abaixo).
- Erro tratado (não uma exceção crua) quando a credencial de login está
  corrompida.
- `pause()`/`resume()`/`cancel()`.

Para cada cenário, o `?scenario=` do mock-server é selecionado numa primeira
navegação (`/mock-uber/login?scenario=X`), e o resto do fluxo usa a config
`buildMockUberConfig`/`MOCK_UBER_SELECTORS` (`src/adapters/uber/mockUberConfig.ts`),
que aponta para o mock-server em vez do site real da Uber - o mesmo código do
adaptador, só a configuração muda.

### Relatório de testes

**Taxa de acerto: 8/8 (100%)** nos 8 cenários da Fase 3 (execução real,
navegador real) - ver [`TEST_REPORT.md`](./TEST_REPORT.md). Para regenerar:

```bash
pnpm --filter @uber-automation/platform-adapters report
```

## Limitações conhecidas

- **`page.route()` não intercepta de forma confiável requisições alcançadas
  via redirect neste ambiente**: a versão do driver `playwright` instalada
  (1.62.x, definida pelo range `^1.46.1`) não bate com a revisão do Chromium
  pré-instalada no ambiente de execução (revisão 1194, mais antiga) - a
  navegação básica funciona normalmente (por isso todos os outros testes
  usam um navegador real), mas a interceptação de rede via CDP para
  requisições que chegam por um redirect HTTP 302 (como o dispatcher de
  cenário do mock-server) não é confiável nessa combinação específica de
  versões. Como o mock-server não tem, de propósito, nenhuma página de
  "sucesso" real para testar o caminho de conclusão (`CompletionStep`) de
  outra forma, esse único caso usa um double mínimo de `Page` em vez do
  navegador real - documentado e isolado em
  `uberDriverApplicationAdapter.test.ts`. Se o ambiente de execução alinhar
  as versões do driver e do navegador no futuro, vale revisitar e trocar por
  um teste 100% real via `page.route()`.
- Os seletores em `selectors.ts` (config "real" da Uber, distinta da config
  de teste em `mockUberConfig.ts`) são a melhor suposição disponível, não
  puderam ser validados contra o site real da Uber neste ambiente - mesma
  ressalva já documentada para o Gmail em
  `packages/email-service/src/playwrightGmailClient.ts` (Fase 2). Confirme
  cada um inspecionando o site real antes do primeiro uso em produção.
- Este pacote não gerencia o ciclo de vida do navegador (abrir/fechar
  browser, isolar sessão por motorista) - isso é responsabilidade de
  `@uber-automation/automation` (`BrowserProfileManager`, Fase 2). O
  chamador é responsável por criar a `Page` (idealmente a partir de um
  contexto persistente por `browserProfileId`) e passá-la ao construtor do
  adaptador.
