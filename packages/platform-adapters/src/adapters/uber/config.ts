/**
 * URLs, timeouts e outros parâmetros do fluxo de cadastro de motorista
 * parceiro da Uber - deliberadamente separados de `selectors.ts` (seletores
 * CSS) e da lógica de automação (`UberDriverApplicationAdapter.ts` e
 * `steps/*.ts`). Quando a Uber mudar algo, o ajuste deve caber inteiramente
 * neste arquivo e em `selectors.ts`, sem tocar em nenhum step.
 *
 * IMPORTANTE - fronteira honesta desta implementação: `baseUrl`/`endpoints`
 * abaixo refletem a estrutura pública conhecida do site de parceiros da
 * Uber no momento em que este código foi escrito, mas não foram (e não
 * puderam ser, neste ambiente) validados contra o site real - ver o mesmo
 * tipo de ressalva em `packages/email-service/src/playwrightGmailClient.ts`
 * para o Gmail. Antes do primeiro uso em produção, confirme cada valor
 * abaixo inspecionando o site real com uma conta de teste.
 *
 * Não há `endpoints.profilePhoto`/`driverLicense`/`completion`: o adaptador
 * nunca navega diretamente para essas páginas (a URL de destino depende de
 * qual etapa/provedor a própria Uber decidir apresentar). O adaptador só
 * clica em botões "Continuar" genéricos e observa onde o fluxo o deixa -
 * ver `continueAdministrativeSteps` em `UberDriverApplicationAdapter.ts`.
 */
export interface UberAdapterTimeouts {
  /** Tempo máximo (ms) esperando uma navegação/carregamento de página. */
  pageLoad: number;
  /** Tempo máximo (ms) esperando um elemento aparecer antes de agir sobre ele. */
  elementWait: number;
  /** Pequena pausa (ms) entre ações, para reduzir a chance de acionar detecção de bot. */
  actionDelay: number;
  /** Polling IMAP aguardando o e-mail de verificação (opcional; default no worker). */
  emailCodePollTimeoutMs?: number;
  emailCodePollIntervalMs?: number;
}

export interface UberAdapterConfig {
  baseUrl: string;
  endpoints: {
    login: string;
    application: string;
    emailVerification: string;
  };
  timeouts: UberAdapterTimeouts;
  /**
   * Máximo de cliques em botões "Continuar" genéricos, entre a verificação
   * de e-mail e a etapa sensível/conclusão, antes de desistir e reportar um
   * erro técnico. Existe para nunca entrar em loop infinito caso o layout
   * mude e o botão pare de nos tirar da página atual.
   */
  maxContinueClicks: number;
  /** Remetente esperado do e-mail de verificação, repassado ao IEmailVerificationWorker (Fase 2) para filtrar candidatos. */
  expectedEmailSender: string;
}

export const UBER_CONFIG: UberAdapterConfig = {
  baseUrl: "https://partners.uber.com",
  endpoints: {
    login: "/login",
    application: "/applications/driver",
    emailVerification: "/applications/driver/email-verify",
  },
  timeouts: {
    pageLoad: 30000,
    elementWait: 10000,
    actionDelay: 1000,
  },
  maxContinueClicks: 8,
  expectedEmailSender: "noreply@uber.com",
};
