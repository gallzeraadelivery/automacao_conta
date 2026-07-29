import { DelayedError } from "bullmq";
import { AuditLogger } from "@uber-automation/security";
import {
  SecurityChallengeError,
  type IEmailVerificationWorker,
} from "@uber-automation/email-service";
import {
  acquireAll,
  releaseAll,
  type ConcurrencyLimiter,
  type ConcurrencyRequest,
} from "./concurrencyLimiter";
import { NonRetryableAutomationError, TechnicalAutomationError } from "./errors";
import { MAX_ATTEMPTS } from "./backoff";
import { AUTOMATION_STEPS, type AutomationJob } from "./automationJob.types";

export const CONCURRENCY_LIMITS = {
  company: 5,
  proxy: 2,
  email: 1,
  applicant: 1,
} as const;

/**
 * Subconjunto do `Job` do BullMQ que a logica de processamento precisa -
 * permite testar `processAutomationJob` sem uma fila/Redis reais.
 */
export interface AutomationJobLike {
  id?: string;
  data: AutomationJob;
  attemptsMade: number;
  opts: { attempts?: number };
  token?: string;
  discard(): void;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export interface ApplicantStatusRepository {
  markAwaitingHumanAction(applicantId: string, reason: string): Promise<void>;
}

export interface ProcessAutomationJobDeps {
  limiter: ConcurrencyLimiter;
  auditLogger: AuditLogger;
  emailVerificationWorker?: IEmailVerificationWorker;
  applicantStatusRepository?: ApplicantStatusRepository;
  /** Atraso (ms) ao reagendar um job que esbarrou em limite de concorrência. */
  retryLaterDelayMs?: number;
}

function concurrencyRequests(data: AutomationJob): ConcurrencyRequest[] {
  return [
    { key: `concurrency:company:${data.companyId}`, limit: CONCURRENCY_LIMITS.company },
    { key: `concurrency:proxy:${data.proxyId}`, limit: CONCURRENCY_LIMITS.proxy },
    { key: `concurrency:email:${data.emailAccountId}`, limit: CONCURRENCY_LIMITS.email },
    { key: `concurrency:applicant:${data.applicantId}`, limit: CONCURRENCY_LIMITS.applicant },
  ];
}

/**
 * Processa um job da fila `automation-jobs`:
 * 1. Adquire os 4 limites de concorrência (empresa/proxy/e-mail/motorista) -
 *    tudo ou nada; se algum estiver no limite, reagenda sem consumir tentativa.
 * 2. Executa a etapa atual (`currentStep`).
 * 3. Classifica qualquer erro como retryable (técnico) ou não-retryable
 *    (exige humano) e audita cada tentativa.
 * 4. Sempre libera os limites de concorrência ao final.
 */
export async function processAutomationJob(
  job: AutomationJobLike,
  deps: ProcessAutomationJobDeps,
): Promise<void> {
  const data = job.data;
  const requests = concurrencyRequests(data);
  const { acquired, acquiredKeys } = await acquireAll(deps.limiter, requests);

  if (!acquired) {
    await deps.auditLogger.log({
      companyId: data.companyId,
      applicantId: data.applicantId,
      action: "automation_job_delayed",
      metadata: { step: data.currentStep, reason: "concurrency_limit_reached" },
    });

    const delay = deps.retryLaterDelayMs ?? 5000;
    await job.moveToDelayed(Date.now() + delay, job.token);
    // Sinaliza ao BullMQ que o job foi deliberadamente adiado - nao e uma
    // falha e nao deve consumir uma tentativa.
    throw new DelayedError();
  }

  try {
    await deps.auditLogger.log({
      companyId: data.companyId,
      applicantId: data.applicantId,
      action: "automation_job_attempt_started",
      metadata: { step: data.currentStep, attempt: job.attemptsMade + 1 },
    });

    await executeStep(job, deps);

    await deps.auditLogger.log({
      companyId: data.companyId,
      applicantId: data.applicantId,
      action: "automation_job_attempt_succeeded",
      metadata: { step: data.currentStep },
    });
  } catch (error) {
    await handleJobError(job, error, deps);
    throw error;
  } finally {
    await releaseAll(deps.limiter, acquiredKeys);
  }
}

async function executeStep(job: AutomationJobLike, deps: ProcessAutomationJobDeps): Promise<void> {
  const data = job.data;

  if (data.currentStep === AUTOMATION_STEPS.AWAIT_EMAIL_CODE) {
    if (!deps.emailVerificationWorker) {
      throw new TechnicalAutomationError(
        "PAGE_UNAVAILABLE",
        "EmailVerificationWorker não configurado",
      );
    }

    // O codigo retornado existe apenas nesta variavel local, em memoria, e e
    // consumido pela proxima etapa da automacao (Fase 3). Nunca e gravado em
    // job.data (que persiste no Redis) nem no banco.
    await deps.emailVerificationWorker.findVerificationCode({
      applicantId: data.applicantId,
      emailAccountId: data.emailAccountId,
      proxyId: data.proxyId,
      requestedAt: new Date(data.createdAt),
    });
    return;
  }

  // Etapas de preenchimento do formulario Uber (packages/platform-adapters)
  // chegam na Fase 3. Ate la, qualquer outra etapa e tratada como erro
  // tecnico esperado (nao implementado), retryable ate ser substituida.
  throw new TechnicalAutomationError(
    "PAGE_UNAVAILABLE",
    `Etapa "${data.currentStep}" ainda não implementada`,
  );
}

async function handleJobError(
  job: AutomationJobLike,
  error: unknown,
  deps: ProcessAutomationJobDeps,
): Promise<void> {
  const data = job.data;

  if (error instanceof NonRetryableAutomationError || error instanceof SecurityChallengeError) {
    job.discard();
    const reason = error instanceof NonRetryableAutomationError ? error.reason : error.challenge;

    await deps.auditLogger.log({
      companyId: data.companyId,
      applicantId: data.applicantId,
      action: "automation_job_paused",
      metadata: { step: data.currentStep, reason, retryable: false },
    });

    if (deps.applicantStatusRepository) {
      await deps.applicantStatusRepository.markAwaitingHumanAction(
        data.applicantId,
        String(reason),
      );
    }
    return;
  }

  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? MAX_ATTEMPTS;
  const reason = error instanceof TechnicalAutomationError ? error.reason : "UNKNOWN";

  await deps.auditLogger.log({
    companyId: data.companyId,
    applicantId: data.applicantId,
    action:
      attempt >= maxAttempts ? "automation_job_failed_final" : "automation_job_attempt_failed",
    metadata: { step: data.currentStep, reason, retryable: true, attempt, maxAttempts },
  });
}
