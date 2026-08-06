import type { Page } from "playwright";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import { AuditLogger } from "@uber-automation/security";
import { PlatformAdapter } from "../../base/PlatformAdapter";
import { REAL_UBER_CONFIG, type RealUberConfig } from "./realConfig";
import type { RealStepContext } from "./realStepContext";
import { HumanInteraction } from "./humanize";
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
  settleAfterAccountCreated,
  hasUberSessionCookies,
  tryResumeHubSession,
} from "./steps/HubSessionSteps";
import {
  confirmEarningLocationStep,
  ensureDriverDocsViaEarnIfNeeded,
  finishEarnThenGoToHubOnBackground,
  hasDriverDocumentEntries,
  selectGenderStep,
  skipBackgroundCheckStep,
} from "./steps/PreferencesSteps";
import { probeVerificationProvidersStep } from "./steps/VerificationProbeSteps";

export interface RealUberSignupAdapterOptions {
  emailWorker: IEmailVerificationWorker;
  auditLogger?: AuditLogger;
  config?: RealUberConfig;
  /** Persiste storageState no perfil do worker (golden após conta/hub). */
  persistSession?: (opts?: { markGolden?: boolean; forceGolden?: boolean }) => Promise<void>;
  allocatePlaceholderPhone?(): Promise<string>;
  markPlaceholderPhoneUsed?(phone: string, reason?: string): Promise<void>;
  allocateEarnCity?(): Promise<string>;
}

/**
 * Adaptador real drivers → bonjour.
 *
 * Se `uberAccountCreated` (audit) ou cookies já abrem o hub: **nunca** refaz
 * signup (identifier/IMAP) — isso pede SMS no telefone placeholder e queima
 * a sessão. Só retoma hub / Driver requirements.
 */
export class RealUberSignupAdapter extends PlatformAdapter {
  private readonly emailWorker: IEmailVerificationWorker;
  private readonly auditLogger: AuditLogger;
  private readonly uberConfig: RealUberConfig;
  private readonly persistSession?: (opts?: {
    markGolden?: boolean;
    forceGolden?: boolean;
  }) => Promise<void>;
  private readonly allocatePlaceholderPhone?: () => Promise<string>;
  private readonly markPlaceholderPhoneUsed?: (phone: string, reason?: string) => Promise<void>;
  private readonly allocateEarnCity?: () => Promise<string>;
  private readonly usedEmailCodes = new Set<string>();
  private human!: HumanInteraction;

  constructor(page: Page, options: RealUberSignupAdapterOptions) {
    super(page);
    this.emailWorker = options.emailWorker;
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.uberConfig = options.config ?? REAL_UBER_CONFIG;
    this.persistSession = options.persistSession;
    this.allocatePlaceholderPhone = options.allocatePlaceholderPhone;
    this.markPlaceholderPhoneUsed = options.markPlaceholderPhoneUsed;
    this.allocateEarnCity = options.allocateEarnCity;
  }

  protected async executeSteps(): Promise<void> {
    this.human = HumanInteraction.forPage(this.page);
    await this.auditLogger.log({
      companyId: this.context.companyId ?? "unknown",
      applicantId: this.context.applicantId,
      action: "uber_real_humanize_session",
      metadata: { seed: this.human.seed },
    });
    const ctx = this.buildStepContext();
    const accountCreated = Boolean(this.context.uberAccountCreated);
    const hasSession = accountCreated || (await hasUberSessionCookies(this.page));

    // (A) Conta nova sem cookies/JWT: não gastar minutos em bonjour/drivers.
    // Resume só quando há indício real de sessão.
    if (!hasSession) {
      await this.auditLogger.log({
        companyId: this.context.companyId ?? "unknown",
        applicantId: this.context.applicantId,
        action: "uber_real_hub_resume_skipped",
        metadata: { reason: "cold_start_no_session" },
      });
    } else if (await tryResumeHubSession(ctx)) {
      if (this.context.uberEarnSetupComplete) {
        await this.finishFromHub(ctx);
        return;
      }
      // Conta no hub sem Delivery/Earn completo — não para em Documents ainda.
      await this.completeEarnThenHub(ctx);
      return;
    }

    if (accountCreated) {
      // Conta existe mas hub não abriu: NÃO refaz signup/IMAP.
      // Caminho manual: Earn → cidade → Delivery with car → background → profile → probe.
      await this.auditLogger.log({
        companyId: this.context.companyId ?? "unknown",
        applicantId: this.context.applicantId,
        action: "uber_real_signup_hub_resume_failed",
        metadata: {
          reason: "account_created_cookies_did_not_open_hub",
          next: "earn_city_delivery_profile_probe",
        },
      });
      await this.completeEarnThenHub(ctx);
      return;
    }

    await openDriversPortal(ctx);
    await fillIdentifierStep(ctx);
    await fillEmailCodeStep(ctx);
    await fillPhoneStep(ctx);
    await fillPasswordStep(ctx);
    await fillNameStep(ctx);
    await acceptTermsStep(ctx);
    await confirmAllSetStep(ctx);
    // Conta criada: sai de auth.uber.com / spinner antes de gênero/cidade.
    await settleAfterAccountCreated(ctx);

    // Fluxo observado: cidade (Earn) → gênero "escolher depois" → background → hub.
    await selectGenderStep(ctx); // se a Uber mostrar gênero antes da cidade
    await confirmEarningLocationStep(ctx);
    await selectGenderStep(ctx); // após cidade (caminho Earn → cidade → gênero)
    await finishEarnThenGoToHubOnBackground(ctx);
    await ensureDriverDocsViaEarnIfNeeded(ctx);
    await probeVerificationProvidersStep(ctx);
  }

  private async finishFromHub(ctx: RealStepContext): Promise<void> {
    await skipBackgroundCheckStep(ctx);
    await ensureDriverDocsViaEarnIfNeeded(ctx);
    await probeVerificationProvidersStep(ctx);
  }

  /** Hub aberto mas sem Earn completo — Earn→cidade→gênero→background→hub. */
  private async completeEarnThenHub(ctx: RealStepContext): Promise<void> {
    // Só pula Earn se a lista Documents já tiver CNH/foto (não só o título).
    if (await hasDriverDocumentEntries(ctx.page, 4_000)) {
      await this.auditLogger.log({
        companyId: this.context.companyId ?? "unknown",
        applicantId: this.context.applicantId,
        action: "uber_real_signup_earn_setup_skipped",
        metadata: { reason: "documents_list_has_license_or_photo" },
      });
      await probeVerificationProvidersStep(ctx);
      return;
    }

    await this.auditLogger.log({
      companyId: this.context.companyId ?? "unknown",
      applicantId: this.context.applicantId,
      action: "uber_real_signup_earn_setup_required",
      metadata: { reason: "documents_list_empty_or_missing" },
    });
    // Ordem manual: uber.com Earn → cidade → Delivery with car → background → hub.
    await confirmEarningLocationStep(ctx);
    await selectGenderStep(ctx);
    await finishEarnThenGoToHubOnBackground(ctx);
    await ensureDriverDocsViaEarnIfNeeded(ctx);
    await probeVerificationProvidersStep(ctx);
  }

  private buildStepContext(): RealStepContext {
    return {
      page: this.page,
      context: this.context,
      config: this.uberConfig,
      emailWorker: this.emailWorker,
      human: this.human,
      recordStep: (step, metadata) => this.recordStep(step, metadata),
      persistSession: this.persistSession,
      usedEmailCodes: this.usedEmailCodes,
      allocatePlaceholderPhone: this.allocatePlaceholderPhone,
      markPlaceholderPhoneUsed: this.markPlaceholderPhoneUsed,
      allocateEarnCity: this.allocateEarnCity,
      assignedPlaceholderPhone: this.context.assignedPlaceholderPhone,
      assignedEarnCity: this.context.assignedEarnCity,
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
