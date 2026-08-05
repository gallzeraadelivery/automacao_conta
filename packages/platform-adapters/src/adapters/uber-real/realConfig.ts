/**
 * URLs e parâmetros do fluxo REAL de cadastro Delivery / motorista parceiro
 * (www.uber.com → Earn → Delivery → auth/drivers → bonjour.uber.com) —
 * baseado em FLUXO_AUTOMACAO_UBER_COM_PRINTS.pdf e no fluxo observado.
 * Diferente de `../uber/config.ts` (site simulado, `apps/mock-server`),
 * este arquivo é usado quando `AUTOMATION_TARGET=production`.
 *
 * IMPORTANTE - fronteira honesta: os seletores em `realSelectors.ts` foram
 * escritos a partir de screenshots (texto/rótulos visíveis), não do HTML
 * real - nenhuma inspeção de DOM foi possível neste ambiente. Uma primeira
 * execução real cuidadosamente observada é o que efetivamente valida (ou
 * corrige) isso.
 */
export interface RealUberConfig {
  /** Fallback direto ao portal (se Earn→Delivery não abrir o signup). */
  driversBaseUrl: string;
  /**
   * Marketing uber.com — entrada primária: menu Earn → Delivery.
   */
  marketingBaseUrl: string;
  /** Landing direta de Delivery (Earn), usada se o menu Earn falhar. */
  deliverLandingUrl: string;
  /** Portal de perfil/documentos, após o cadastro administrativo (Passo 12+ do PDF). */
  profileUrl: string;
  timeouts: {
    pageLoad: number;
    elementWait: number;
    actionDelay: number;
    /**
     * Quanto tempo o passo do código OTP espera o e-mail chegar via IMAP
     * (polling). A Uber costuma atrasar alguns segundos; sem isso a busca
     * única falha mesmo com o e-mail já a caminho.
     */
    emailCodePollTimeoutMs: number;
    emailCodePollIntervalMs: number;
  };
  /** Sufixo fixo da senha gerada - ver `buildPlaceholderPassword` em nameUtils.ts. */
  passwordSuffix: string;
  /** Opção do gênero (placeholder - corrigido pelo atendente na finalização, nunca dado real do motorista). */
  genderOptionLabel: string;
  /** Card do tipo de serviço a selecionar (fixo, ver PDF "Notas Importantes"). */
  serviceTypeLabel: string;
}

export const REAL_UBER_CONFIG: RealUberConfig = {
  driversBaseUrl: "https://drivers.uber.com",
  marketingBaseUrl: "https://www.uber.com/us/en/",
  deliverLandingUrl: "https://www.uber.com/us/en/deliver/",
  profileUrl: "https://bonjour.uber.com/profile",
  timeouts: {
    pageLoad: 30000,
    elementWait: 15000,
    actionDelay: 500,
    emailCodePollTimeoutMs: 90_000,
    emailCodePollIntervalMs: 3_000,
  },
  passwordSuffix: "@2026",
  // Placeholder administrativo — "escolher depois" (fluxo real observado).
  genderOptionLabel: "Prefer to choose later",
  serviceTypeLabel: "Delivery with car",
};
