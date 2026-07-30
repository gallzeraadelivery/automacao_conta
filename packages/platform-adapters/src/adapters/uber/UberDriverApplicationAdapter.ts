import type { Page } from "playwright";
import { CredentialVault, type ICredentialVault } from "@uber-automation/credential-vault";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import { AuditLogger } from "@uber-automation/security";
import {
  VerificationFlowDetector,
  classifyPageType,
  type IVerificationFlowDetector,
} from "@uber-automation/verification-detector";
import { PlatformAdapter } from "../../base/PlatformAdapter";
import { AutomationPauseSignal, AutomationTechnicalError } from "../../types";
import { toTechnicalError } from "../errorMapping";
import type { StepContext } from "../types";
import { UBER_CONFIG, type UberAdapterConfig } from "./config";
import { UBER_SELECTORS, type UberSelectors } from "./selectors";
import { runApplicationFormStep } from "./steps/ApplicationFormStep";
import { runCompletionStep } from "./steps/CompletionStep";
import { runDriverLicenseStep } from "./steps/DriverLicenseStep";
import { runEmailVerificationStep } from "./steps/EmailVerificationStep";
import { runLoginStep } from "./steps/LoginStep";
import { runProfilePhotoStep } from "./steps/ProfilePhotoStep";

export interface UberDriverApplicationAdapterOptions {
  emailWorker: IEmailVerificationWorker;
  detector?: IVerificationFlowDetector;
  vault?: ICredentialVault;
  auditLogger?: AuditLogger;
  config?: UberAdapterConfig;
  selectors?: UberSelectors;
}

/**
 * Adaptador de plataforma para o fluxo de cadastro de motorista parceiro da
 * Uber: navega pelo login e formulário administrativo, resolve o código de
 * verificação por e-mail, e para assim que encontra qualquer etapa sensível
 * (foto de perfil, CNH, CAPTCHA, 2FA, bloqueio de segurança) - nunca tenta
 * concluí-la. Ver README do pacote para as regras de segurança obrigatórias
 * e um passo a passo de uso.
 */
export class UberDriverApplicationAdapter extends PlatformAdapter {
  private readonly detector: IVerificationFlowDetector;
  private readonly emailWorker: IEmailVerificationWorker;
  private readonly vault: ICredentialVault;
  private readonly auditLogger: AuditLogger;
  private readonly uberConfig: UberAdapterConfig;
  private readonly selectors: UberSelectors;

  constructor(page: Page, options: UberDriverApplicationAdapterOptions) {
    super(page);
    this.emailWorker = options.emailWorker;
    this.detector = options.detector ?? new VerificationFlowDetector();
    this.vault = options.vault ?? new CredentialVault();
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.uberConfig = options.config ?? UBER_CONFIG;
    this.selectors = options.selectors ?? UBER_SELECTORS;
  }

  protected async executeSteps(): Promise<void> {
    const ctx = this.buildStepContext();

    await runLoginStep(ctx);
    await runApplicationFormStep(ctx);
    await runEmailVerificationStep(ctx);
    await this.continueAdministrativeSteps(ctx);
  }

  private buildStepContext(): StepContext<UberAdapterConfig, UberSelectors> {
    return {
      page: this.page,
      context: this.context,
      config: this.uberConfig,
      selectors: this.selectors,
      vault: this.vault,
      detector: this.detector,
      emailWorker: this.emailWorker,
      recordStep: (step, metadata) => this.recordStep(step, metadata),
    };
  }

  private async recordStep(step: string, metadata?: Record<string, unknown>): Promise<void> {
    this.currentStep = step;
    await this.auditLogger.log({
      companyId: this.context.companyId ?? "unknown",
      applicantId: this.context.applicantId,
      action: `uber_automation_${step.toLowerCase()}`,
      metadata,
    });
  }

  /**
   * Depois do e-mail verificado, avança clicando em botões "Continuar"
   * genéricos (nenhum campo novo, nenhum documento) até encontrar uma etapa
   * sensível/desafio ou até não haver mais nada para continuar - nunca mais
   * do que `config.maxContinueClicks` vezes, para nunca entrar em loop
   * infinito se o layout mudar.
   */
  private async continueAdministrativeSteps(
    ctx: StepContext<UberAdapterConfig, UberSelectors>,
  ): Promise<void> {
    for (let attempt = 0; attempt < this.uberConfig.maxContinueClicks; attempt++) {
      const html = await this.page.content();
      const pageType = classifyPageType(html);

      switch (pageType) {
        case "SECURITY_BLOCK":
          await ctx.recordStep("VERIFICATION_DETECTED", { verificationType: "SECURITY_BLOCK" });
          throw new AutomationPauseSignal("SECURITY_BLOCK", {
            type: "SECURITY_BLOCK",
            provider: "UNKNOWN",
            confidence: "HIGH",
          });

        case "CAPTCHA":
          await ctx.recordStep("VERIFICATION_DETECTED", { verificationType: "CAPTCHA" });
          throw new AutomationPauseSignal("CAPTCHA", {
            type: "CAPTCHA",
            provider: "UNKNOWN",
            confidence: "HIGH",
          });

        case "TWO_FACTOR":
          await ctx.recordStep("VERIFICATION_DETECTED", { verificationType: "TWO_FACTOR" });
          throw new AutomationPauseSignal("TWO_FACTOR", {
            type: "TWO_FACTOR",
            provider: "UNKNOWN",
            confidence: "HIGH",
          });

        case "PROFILE_PHOTO":
          await runProfilePhotoStep(ctx);
          return;

        case "DRIVER_LICENSE":
          await runDriverLicenseStep(ctx);
          return;

        case "UNKNOWN":
        default: {
          const clicked = await this.clickGenericContinueButton();
          if (!clicked) {
            await runCompletionStep(ctx);
            return;
          }
        }
      }
    }

    throw new AutomationTechnicalError(
      "MAX_CONTINUE_CLICKS_EXCEEDED",
      `Excedeu o limite de ${this.uberConfig.maxContinueClicks} cliques em "Continuar" sem chegar a uma etapa reconhecida`,
    );
  }

  private async clickGenericContinueButton(): Promise<boolean> {
    const button = await this.page.$(this.selectors.continueButton).catch(() => null);
    if (!button) return false;

    try {
      await button.click();
      await this.page.waitForLoadState("domcontentloaded", {
        timeout: this.uberConfig.timeouts.pageLoad,
      });
      if (this.uberConfig.timeouts.actionDelay > 0) {
        await this.page.waitForTimeout(this.uberConfig.timeouts.actionDelay);
      }
    } catch (error) {
      throw toTechnicalError(error, "ELEMENT_NOT_FOUND", 'Falha ao clicar em "Continuar"');
    }

    return true;
  }
}
