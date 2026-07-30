import type { Page } from "playwright";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import { AuditLogger } from "@uber-automation/security";
import { PlatformAdapter } from "../../base/PlatformAdapter";
import { REAL_UBER_CONFIG, type RealUberConfig } from "./realConfig";
import type { RealStepContext } from "./realStepContext";
import {
  acceptTermsStep,
  confirmAllSetStep,
  fillEmailCodeStep,
  fillIdentifierStep,
  fillNameStep,
  fillPasswordStep,
  fillPhoneStep,
  openDriversPortal,
} from "./steps/AccountCreationSteps";
import {
  confirmEarningLocationStep,
  reachDriverRequirementsStep,
  selectGenderStep,
  selectServiceTypeStep,
  skipBackgroundCheckStep,
} from "./steps/PreferencesSteps";

export interface RealUberSignupAdapterOptions {
  emailWorker: IEmailVerificationWorker;
  auditLogger?: AuditLogger;
  config?: RealUberConfig;
}

/**
 * Adaptador para o fluxo REAL de cadastro de motorista parceiro
 * (drivers.uber.com -> bonjour.uber.com), baseado em
 * FLUXO_AUTOMACAO_UBER_COM_PRINTS.pdf (prints reais fornecidos pelo
 * usuário). Cobre só a parte 100% administrativa (conta, telefone
 * placeholder, senha, nome, termos, gênero placeholder, localização de
 * ganho, tipo de serviço, pular consentimento de background check) e para
 * SEMPRE ao chegar em "Driver requirements" - nunca clica em "Driver's
 * License" nem "Profile Picture" (isso ativaria captura de
 * câmera/documento na própria página da Uber, proibido pelas regras de
 * segurança obrigatórias deste projeto).
 *
 * Diferente de `UberDriverApplicationAdapter` (mock, `apps/mock-server`),
 * usado apenas quando `AUTOMATION_TARGET=production` (apps/worker).
 *
 * Fronteira honesta: seletores escritos a partir de screenshots (texto
 * visível), nunca inspecionados no HTML real - a primeira execução real
 * observada de perto é o que efetivamente valida isso. Ver README do pacote.
 */
export class RealUberSignupAdapter extends PlatformAdapter {
  private readonly emailWorker: IEmailVerificationWorker;
  private readonly auditLogger: AuditLogger;
  private readonly uberConfig: RealUberConfig;

  constructor(page: Page, options: RealUberSignupAdapterOptions) {
    super(page);
    this.emailWorker = options.emailWorker;
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.uberConfig = options.config ?? REAL_UBER_CONFIG;
  }

  protected async executeSteps(): Promise<void> {
    const ctx = this.buildStepContext();

    await openDriversPortal(ctx);
    await fillIdentifierStep(ctx);
    await fillEmailCodeStep(ctx);
    await fillPhoneStep(ctx);
    await fillPasswordStep(ctx);
    await fillNameStep(ctx);
    await acceptTermsStep(ctx);
    await confirmAllSetStep(ctx);
    await selectGenderStep(ctx);
    await confirmEarningLocationStep(ctx);
    await selectServiceTypeStep(ctx);
    await skipBackgroundCheckStep(ctx);
    await reachDriverRequirementsStep(ctx);
  }

  private buildStepContext(): RealStepContext {
    return {
      page: this.page,
      context: this.context,
      config: this.uberConfig,
      emailWorker: this.emailWorker,
      recordStep: (step, metadata) => this.recordStep(step, metadata),
    };
  }

  private async recordStep(step: string, metadata?: Record<string, unknown>): Promise<void> {
    this.currentStep = step;
    await this.auditLogger.log({
      companyId: this.context.companyId ?? "unknown",
      applicantId: this.context.applicantId,
      action: `uber_real_signup_${step.toLowerCase()}`,
      metadata,
    });
  }
}
