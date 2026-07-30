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
}
