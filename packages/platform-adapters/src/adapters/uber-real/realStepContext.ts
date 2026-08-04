import type { Page } from "playwright";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import type { AutomationContext } from "../../types";
import type { RealUberConfig } from "./realConfig";

/**
 * Contexto passado a cada step do fluxo REAL (drivers.uber.com). Mais
 * enxuto que `StepContext<TConfig,TSelectors>` (usado pelo fluxo do mock)
 * porque este fluxo não faz login numa conta existente (não precisa de
 * `vault`/`platformCredential` - a senha é gerada, não descriptografada) e
 * nunca chega perto de uma página classificável por `detector` (a
 * automação pausa antes de entrar em Driver's License/Profile Picture).
 */
export interface RealStepContext {
  page: Page;
  context: AutomationContext;
  config: RealUberConfig;
  emailWorker: IEmailVerificationWorker;
  recordStep(step: string, metadata?: Record<string, unknown>): Promise<void>;
  /**
   * Instantâneo em que o e-mail/telefone foi submetido na Uber (início da
   * janela de elegibilidade do código IMAP). Preenchido por
   * `fillIdentifierStep` e consumido por `fillEmailCodeStep`.
   */
  emailCodeRequestedAt?: Date;
  /** Códigos OTP de e-mail já tentados nesta execução (evita reusar após rotação). */
  usedEmailCodes?: Set<string>;
  /**
   * Aloca o próximo placeholder livre (pula números já usados / SMS rejeitado).
   * Injetado pelo worker.
   */
  allocatePlaceholderPhone?(): Promise<string>;
  /**
   * Marca placeholder como usado (hub/cidade **ou** SMS rejeitado).
   * Injetado pelo worker.
   */
  markPlaceholderPhoneUsed?(phone: string, reason?: string): Promise<void>;
  /** Último placeholder submetido com sucesso (senha) nesta execução. */
  assignedPlaceholderPhone?: string;
  /**
   * Próxima cidade do rodízio (Earn with Uber).
   * Injetado pelo worker.
   */
  allocateEarnCity?(): Promise<string>;
  /** Cidade escolhida nesta execução (auditoria / debug). */
  assignedEarnCity?: string;
  /**
   * Persiste cookies/storageState no perfil.
   * `markGolden` = sessão “de ouro” (pós cidade / hub).
   * `forceGolden` = grava golden mesmo sem cookies tipicamente de hub
   * (ex.: após confirmar cidade no onboarding).
   */
  persistSession?(opts?: { markGolden?: boolean; forceGolden?: boolean }): Promise<void>;
}
