/**
 * Adaptadores especificos de plataforma (ex: fluxo de cadastro de motorista
 * parceiro da Uber) - navega pelo cadastro administrativo, preenche dados,
 * resolve o código de verificação por e-mail, e para assim que qualquer
 * etapa sensível é detectada (foto de perfil, CNH, CAPTCHA, 2FA, bloqueio
 * de segurança), entregando a sessão para o motorista concluir pessoalmente.
 *
 * NUNCA envia documentos/selfies, nunca acessa câmera, nunca resolve
 * CAPTCHA/2FA, nunca conclui verificação de identidade, nunca altera o
 * provedor de verificação escolhido pela plataforma. Ver README do pacote
 * para o detalhamento das regras de segurança obrigatórias.
 */
export * from "./types";
export { PlatformAdapter } from "./base/PlatformAdapter";
export type { StepContext } from "./adapters/types";

export {
  UberDriverApplicationAdapter,
  type UberDriverApplicationAdapterOptions,
} from "./adapters/uber/UberDriverApplicationAdapter";
export {
  UBER_CONFIG,
  type UberAdapterConfig,
  type UberAdapterTimeouts,
} from "./adapters/uber/config";
export { UBER_SELECTORS, type UberSelectors, type FieldSelector } from "./adapters/uber/selectors";
export {
  buildMockUberConfigFromBaseUrl,
  MOCK_UBER_SELECTORS,
} from "./adapters/uber/mockUberConfig";

export {
  RealUberSignupAdapter,
  type RealUberSignupAdapterOptions,
} from "./adapters/uber-real/RealUberSignupAdapter";
export { REAL_UBER_CONFIG, type RealUberConfig } from "./adapters/uber-real/realConfig";
