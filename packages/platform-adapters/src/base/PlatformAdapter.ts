import type { Page } from "playwright";
import {
  AutomationPauseSignal,
  AutomationTechnicalError,
  type AutomationContext,
  type AutomationResult,
  type AutomationStatus,
  type IPlatformAdapter,
} from "../types";

/**
 * Classe base para adaptadores de plataforma (ex: Uber). Responsável apenas
 * pelo ciclo de vida (status, etapa atual, tradução de exceções conhecidas
 * em `AutomationResult`) - toda a lógica específica da plataforma vive na
 * subclasse, em `executeSteps()`.
 *
 * `page` é injetado no construtor (não criado aqui): quem instancia o
 * adaptador é responsável por abrir o navegador/contexto correto (ex: via
 * `BrowserProfileManager`, reaproveitando a sessão isolada do motorista) e
 * por fechá-lo depois. Este pacote não gerencia perfis de navegador nem
 * proxies - isso é responsabilidade de `@uber-automation/automation`.
 */
export abstract class PlatformAdapter implements IPlatformAdapter {
  protected readonly page: Page;
  protected context!: AutomationContext;
  protected currentStep = "INIT";
  protected status: AutomationStatus = "IDLE";

  constructor(page: Page) {
    this.page = page;
  }

  async start(context: AutomationContext): Promise<AutomationResult> {
    this.context = context;
    this.status = "RUNNING";

    try {
      await this.executeSteps();
      this.status = "COMPLETED";
      return { status: "SUCCESS", currentStep: this.currentStep };
    } catch (error) {
      if (error instanceof AutomationPauseSignal) {
        this.status = "PAUSED";
        return {
          status: error.verificationDetected ? "VERIFICATION_DETECTED" : "PAUSED",
          currentStep: this.currentStep,
          pauseReason: error.pauseReason,
          verificationDetected: error.verificationDetected,
          error: { code: error.pauseReason, message: error.message },
        };
      }

      if (error instanceof AutomationTechnicalError) {
        this.status = "ERROR";
        return {
          status: "ERROR",
          currentStep: this.currentStep,
          error: { code: error.code, message: error.message },
        };
      }

      this.status = "ERROR";
      return {
        status: "ERROR",
        currentStep: this.currentStep,
        error: {
          code: "UNKNOWN_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async pause(): Promise<void> {
    if (this.status === "RUNNING") this.status = "PAUSED";
  }

  async resume(): Promise<void> {
    if (this.status === "PAUSED") this.status = "RUNNING";
  }

  async cancel(): Promise<void> {
    this.status = "CANCELLED";
    await this.page.close().catch(() => undefined);
  }

  getCurrentStep(): string {
    return this.currentStep;
  }

  getStatus(): AutomationStatus {
    return this.status;
  }

  protected abstract executeSteps(): Promise<void>;
}
