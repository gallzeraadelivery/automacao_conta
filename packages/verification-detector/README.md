# @uber-automation/verification-detector

Módulo **exclusivamente informativo**: identifica qual provedor de verificação de
identidade está sendo apresentado ao motorista (Socure, outro provedor, ou
desconhecido) a partir de sinais normalmente disponíveis na página (URL, domínio,
título, texto visível, atributos HTML, nomes de scripts, recursos carregados).

**Nunca** tenta contornar, resolver, alterar ou influenciar a verificação - apenas
observa e classifica. Não interage com CAPTCHA/2FA, não decide qual provedor a
plataforma deve usar, não envia documentos/selfies.

## Uso

```ts
import { VerificationFlowDetector } from "@uber-automation/verification-detector";

const detector = new VerificationFlowDetector();

// context.page é opcional (reservado para uso futuro) - o algoritmo em si
// opera inteiramente sobre url/html/scripts/resources já extraídos pelo
// chamador (ex: via page.url(), page.content(), etc. do Playwright).
const result = await detector.detectProfilePhotoProvider({
  page: currentPlaywrightPage, // opcional
  url: page.url(),
  html: await page.content(),
  scripts: await page.evaluate(() => Array.from(document.scripts).map((s) => s.src)),
  resources: [], // URLs de recursos carregados, se disponíveis (ex: via page.on('request'))
});

console.log(result);
// {
//   type: 'PROFILE_PHOTO_VERIFICATION',
//   provider: 'SOCURE',
//   confidence: 'HIGH',
//   detectedDomain: 'socure.com',
//   detectionMethod: 'HTML_ATTRIBUTE',
//   signals: ['Atributo data-provider="socure" encontrado no HTML', ...]
// }
```

Antes de chamar `detectProfilePhotoProvider`/`detectDriverLicenseProvider`, use os
métodos síncronos para descobrir que tipo de página está sendo exibida (não fazem
sentido chamar juntos - CAPTCHA/2FA/bloqueio não têm provedor de identidade a
detectar):

```ts
const html = await page.content();

if (detector.isSecurityBlockPage(html)) {
  // pausar, nunca contornar - ver packages/email-service SecurityChallengeError
} else if (detector.isCaptchaPage(html) || detector.isTwoFactorPage(html)) {
  // pausar, exigir intervenção humana
} else if (detector.isProfilePhotoPage(html)) {
  const result = await detector.detectProfilePhotoProvider({
    url: page.url(),
    html,
    scripts,
    resources,
  });
} else if (detector.isDriverLicensePage(html)) {
  const result = await detector.detectDriverLicenseProvider({
    url: page.url(),
    html,
    scripts,
    resources,
  });
}

// ou, de forma agregada:
detector.classifyPageType(html); // 'PROFILE_PHOTO' | 'DRIVER_LICENSE' | 'CAPTCHA' | 'TWO_FACTOR' | 'SECURITY_BLOCK' | 'UNKNOWN'
```

## Classificações possíveis (`provider`)

| Valor            | Significado                                                                                                                                                                                 | Confiança típica                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `SOCURE`         | Evidência direta e clara de que é a Socure (nome, domínio, script)                                                                                                                          | `HIGH`                                                                           |
| `NOT_SOCURE`     | Um provedor **nomeado** diferente da Socure foi identificado com clareza (nome ou domínio batem)                                                                                            | `HIGH`                                                                           |
| `OTHER_PROVIDER` | Há evidência de que é um terceiro (não Uber, não Socure), mas o nome/domínio exato não foi confirmado com confiança alta (ex: só um padrão genérico "Powered by X" com nome não catalogado) | `MEDIUM`                                                                         |
| `UBER_INTERNAL`  | A própria Uber parece estar processando a etapa diretamente (domínio `uber.com`, sem sinal de terceiro)                                                                                     | `MEDIUM`/`HIGH`                                                                  |
| `UNKNOWN`        | Nenhuma evidência suficiente, sinais conflitantes, ou a página declara explicitamente que não é possível identificar                                                                        | `LOW` (há aviso explícito de ambiguidade) ou `UNKNOWN` (nenhum sinal encontrado) |

> `NOT_SOCURE` vs. `OTHER_PROVIDER`: o briefing da Fase 4 lista os dois como valores
> possíveis do mesmo campo sem diferenciar claramente. Esta implementação usa
> `NOT_SOCURE` quando um provedor **nomeado** é identificado com confiança alta (o que
> os exemplos de teste do briefing esperam para IDology/Jumio), e reserva
> `OTHER_PROVIDER` para o caso intermediário de "claramente não é Socure/Uber, mas o
> nome exato não pôde ser confirmado" - dando um papel distinto a cada valor do enum.

## Sinais analisados (`detectionMethod`)

| Método            | O que verifica                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `URL_DOMAIN`      | Domínio da URL atual bate com um provedor conhecido (ex: `verify.socure.com`)                       |
| `HTML_ATTRIBUTE`  | Atributo `data-provider="..."` no HTML                                                              |
| `HTML_TITLE`      | Conteúdo da tag `<title>`                                                                           |
| `HTML_TEXT`       | Texto visível da página (nome do provedor, ou padrão genérico "Powered by X" / "Verificação por X") |
| `SCRIPT_NAME`     | Nome/domínio de um `<script src="...">` carregado                                                   |
| `RESOURCE_DOMAIN` | Domínio de um recurso carregado (imagem, chamada de API, etc.)                                      |

Todo sinal encontrado é reportado em `signals: string[]` (evidência legível), mesmo os
que não determinaram a classificação final - útil para auditoria/depuração.

## Regras de prioridade na classificação

1. Sinal **forte** de Socure (nome/domínio/atributo/script) → `SOCURE` / `HIGH`
2. Sinal **forte** de um provedor concorrente **nomeado** → `NOT_SOCURE` / `HIGH`
3. Sinal **forte** genérico de "outro provedor" sem nome catalogado (ex: só o atributo
   `data-provider="other"`) → `NOT_SOCURE` / `HIGH`
4. Aviso explícito de ambiguidade na própria página → `UNKNOWN` / `LOW`
5. Sinal **fraco** de outro provedor (ex: padrão textual "Powered by X" com nome não
   reconhecido) → `OTHER_PROVIDER` / `MEDIUM`
6. Domínio da própria Uber, sem sinal de terceiro → `UBER_INTERNAL`
7. Nenhum sinal → `UNKNOWN` / `UNKNOWN`

Evidência forte sempre vence evidência fraca conflitante (ex: um comentário perdido
mencionando outro nome não derruba um `data-provider="socure"` + script `socure.com`
explícitos - ver teste `never lets a conflicting weak signal override a strong Socure
signal`).

## Provedores reconhecidos por nome/domínio

Além da Socure, a lista em `providerRegistry.ts` reconhece explicitamente: IDology,
Jumio, Onfido, Veriff, Persona, Trulioo, Mitek, e o provedor simulado da Fase 3
("Verificador XYZ"). **Esta lista não precisa ser exaustiva**: qualquer provedor
nomeado que apareça no HTML (padrão "Powered by X") ou que declare explicitamente
`data-provider="..."` é detectado mesmo sem estar catalogado - a lista só existe para
reconhecer o **domínio** de provedores conhecidos e para o `SCRIPT_NAME`/`URL_DOMAIN`
funcionarem sem depender de o nome aparecer em texto.

## Precisão validada

100% (8/8) contra todos os cenários da Fase 3, executando o detector contra o HTML
**real** renderizado por `apps/mock-server` (não fixtures escritas à mão) - ver
[`ACCURACY_REPORT.md`](./ACCURACY_REPORT.md) para o relatório completo com os sinais
encontrados em cada página. Para regenerar:

```bash
pnpm --filter @uber-automation/verification-detector report
```

## Limitações conhecidas

- Falso-positivo evitado, mas documentado como risco de classe: uma palavra isolada
  como "captcha" ou "2fa" aparecendo em navegação/menu (não no desafio em si) pode
  gerar falso positivo em `isCaptchaPage`/`isTwoFactorPage` se os padrões forem
  afrouxados demais. Por isso os padrões genéricos exigem contexto (`recaptcha`, "não
  sou um robô" em vez de só `captcha`; `2fa` só combinado com "auth"/"verification"/
  "código" em vez de sozinho). Isso foi encontrado e corrigido durante os testes de
  integração desta fase, ao rodar contra a página de login real do mock server (que
  lista os nomes de todos os cenários de teste, incluindo "captcha" e "2fa", em um
  seletor de navegação).
- A detecção opera inteiramente sobre `html`/`scripts`/`resources`/`url` fornecidos
  pelo chamador - não executa JavaScript nem inspeciona a página viva. Conteúdo
  renderizado dinamicamente após o carregamento inicial (ex: um SDK que injeta a marca
  do provedor via JS depois do load) só é visto se o chamador capturar o HTML _depois_
  dessa renderização (ex: aguardar `page.waitForSelector` antes de chamar
  `page.content()`).
