import type { Page } from "playwright";
import type { ICredentialVault } from "@uber-automation/credential-vault";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import type { IVerificationFlowDetector } from "@uber-automation/verification-detector";
import type { AutomationContext } from "../types";

/**
 * Tudo que um step de um adaptador de plataforma precisa para agir - passado
 * por composição (não herança) para manter cada step uma função/classe
 * pequena e testável isoladamente. `TConfig`/`TSelectors` são específicos de
 * cada plataforma (ex: `UberAdapterConfig`/`UberSelectors`).
 */
export interface StepContext<TConfig, TSelectors> {
  page: Page;
  context: AutomationContext;
  config: TConfig;
  selectors: TSelectors;
  vault: ICredentialVault;
  detector: IVerificationFlowDetector;
  emailWorker: IEmailVerificationWorker;
  /** Registra um passo concluído em auditoria (metadata sensível já é mascarada pelo AuditLogger). */
  recordStep(step: string, metadata?: Record<string, unknown>): Promise<void>;
}
