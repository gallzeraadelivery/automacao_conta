import { describe, it, expect, vi } from "vitest";
import { DelayedError } from "bullmq";
import { AuditLogger } from "@uber-automation/security";
import {
  SecurityChallengeError,
  type IEmailVerificationWorker,
} from "@uber-automation/email-service";
import { ConcurrencyLimiter, type RedisEvalClient } from "./concurrencyLimiter";
import {
  processAutomationJob,
  type AutomationJobLike,
  type ApplicantStatusRepository,
} from "./processor";
import { NonRetryableAutomationError, TechnicalAutomationError } from "./errors";
import type { AutomationJob } from "./automationJob.types";

class FakeRedis implements RedisEvalClient {
  counters = new Map<string, number>();

  async eval(script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const key = String(args[0]);
    const current = this.counters.get(key) ?? 0;
    if (script.includes("INCR")) {
      const limit = Number(args[1]);
      if (current >= limit) return 0;
      this.counters.set(key, current + 1);
      return 1;
    }
    if (current > 0) this.counters.set(key, current - 1);
    return 1;
  }
}

function baseJobData(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    companyId: "company-1",
    applicantId: "applicant-1",
    browserProfileId: "profile-1",
    emailAccountId: "email-1",
    proxyId: "proxy-1",
    platformAdapter: "uber",
    currentStep: "AWAIT_EMAIL_CODE",
    retryCount: 0,
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

class FakeJob implements AutomationJobLike {
  id = "job-1";
  attemptsMade = 0;
  opts = { attempts: 3 };
  token = "token-1";
  discarded = false;
  delayedTo: number | null = null;

  constructor(public data: AutomationJob) {}

  discard() {
    this.discarded = true;
  }

  async moveToDelayed(timestamp: number) {
    this.delayedTo = timestamp;
  }
}

function buildDeps(
  overrides: Partial<{
    emailVerificationWorker: IEmailVerificationWorker;
    applicantStatusRepository: ApplicantStatusRepository;
    redis: FakeRedis;
  }> = {},
) {
  const redis = overrides.redis ?? new FakeRedis();
  const sink = vi.fn();
  const auditLogger = new AuditLogger({ sink });
  const limiter = new ConcurrencyLimiter(redis);

  return {
    limiter,
    auditLogger,
    sink,
    redis,
    emailVerificationWorker: overrides.emailVerificationWorker,
    applicantStatusRepository: overrides.applicantStatusRepository,
  };
}

describe("processAutomationJob", () => {
  it("acquires and releases all 4 concurrency locks around a successful step", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi.fn().mockResolvedValue({ code: "123456", confidence: "HIGH" }),
      handleSecurityChallenge: vi.fn(),
    };
    const deps = buildDeps({ emailVerificationWorker });
    const job = new FakeJob(baseJobData());

    await processAutomationJob(job, deps);

    expect(emailVerificationWorker.findVerificationCode).toHaveBeenCalledOnce();
    // slots released back to 0 after processing
    expect(deps.redis.counters.get("concurrency:company:company-1")).toBe(0);
    expect(deps.redis.counters.get("concurrency:proxy:proxy-1")).toBe(0);
    expect(deps.redis.counters.get("concurrency:email:email-1")).toBe(0);
    expect(deps.redis.counters.get("concurrency:applicant:applicant-1")).toBe(0);

    const actions = deps.sink.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("automation_job_attempt_started");
    expect(actions).toContain("automation_job_attempt_succeeded");
  });

  it("defers the job without consuming an attempt when a concurrency limit is reached", async () => {
    const redis = new FakeRedis();
    // exhaust the per-applicant slot ahead of time
    redis.counters.set("concurrency:applicant:applicant-1", 1);

    const deps = buildDeps({ redis });
    const job = new FakeJob(baseJobData());

    await expect(processAutomationJob(job, deps)).rejects.toThrow(DelayedError);

    expect(job.delayedTo).not.toBeNull();
    const actions = deps.sink.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["automation_job_delayed"]);
    expect(actions).not.toContain("automation_job_attempt_started");
    // other locks that WERE acquired before the failing one must be rolled back
    expect(redis.counters.get("concurrency:company:company-1")).toBe(0);
  });

  it("marks the job as paused (discarded) and notifies via applicant status on a non-retryable error", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi.fn().mockRejectedValue(new NonRetryableAutomationError("CAPTCHA")),
      handleSecurityChallenge: vi.fn(),
    };
    const markAwaitingHumanAction = vi.fn();
    const deps = buildDeps({
      emailVerificationWorker,
      applicantStatusRepository: { markAwaitingHumanAction },
    });
    const job = new FakeJob(baseJobData());

    await expect(processAutomationJob(job, deps)).rejects.toThrow(NonRetryableAutomationError);

    expect(job.discarded).toBe(true);
    expect(markAwaitingHumanAction.mock.calls[0]?.[0]).toBe("applicant-1");
    expect(markAwaitingHumanAction.mock.calls[0]?.[1]).toBe("CAPTCHA");
    const actions = deps.sink.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("automation_job_paused");
    expect(actions).not.toContain("automation_job_attempt_failed");
  });

  it("discards REFUSED (Uber Internal Server Error) as FAILED without pending action", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi
        .fn()
        .mockRejectedValue(
          new NonRetryableAutomationError(
            "REFUSED",
            "Uber Internal Server Error — e-mail descartado (sem retentar)",
          ),
        ),
      handleSecurityChallenge: vi.fn(),
    };
    const markDiscarded = vi.fn();
    const markAwaitingHumanAction = vi.fn();
    const deps = buildDeps({
      emailVerificationWorker,
      applicantStatusRepository: { markAwaitingHumanAction, markDiscarded },
    });
    const job = new FakeJob(baseJobData());

    await expect(processAutomationJob(job, deps)).rejects.toThrow(NonRetryableAutomationError);

    expect(job.discarded).toBe(true);
    expect(markDiscarded).toHaveBeenCalledWith("applicant-1", "email-1", "REFUSED");
    expect(markAwaitingHumanAction).not.toHaveBeenCalled();
    const actions = deps.sink.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("automation_job_discarded");
    expect(actions).not.toContain("automation_job_paused");
  });

  it("marks PHONE_PROBLEM as FAILED (not pending) so the queue continues", async () => {
    const markFailed = vi.fn();
    const markAwaitingHumanAction = vi.fn();
    const deps = {
      ...buildDeps({
        emailVerificationWorker: {
          findVerificationCode: vi.fn(),
          handleSecurityChallenge: vi.fn(),
        },
        applicantStatusRepository: { markAwaitingHumanAction, markFailed },
      }),
      runAdministrativeFlow: async () => {
        throw new NonRetryableAutomationError(
          "PHONE_PROBLEM",
          "Problema celular: Uber pediu OTP SMS em 2 números",
        );
      },
    };
    const job = new FakeJob(baseJobData({ currentStep: "RUN_ADMINISTRATIVE_FLOW" }));

    await expect(processAutomationJob(job, deps)).rejects.toThrow(NonRetryableAutomationError);

    expect(job.discarded).toBe(true);
    expect(markFailed).toHaveBeenCalledWith("applicant-1", "PHONE_PROBLEM");
    expect(markAwaitingHumanAction).not.toHaveBeenCalled();
    const actions = deps.sink.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("automation_job_phone_problem");
    expect(actions).not.toContain("automation_job_paused");
  });

  it("pauses (does not retry) when the email worker reports a security challenge", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi
        .fn()
        .mockRejectedValue(new SecurityChallengeError("TWO_FACTOR", "requires human action")),
      handleSecurityChallenge: vi.fn(),
    };
    const markAwaitingHumanAction = vi.fn();
    const deps = buildDeps({
      emailVerificationWorker,
      applicantStatusRepository: { markAwaitingHumanAction },
    });
    const job = new FakeJob(baseJobData());

    await expect(processAutomationJob(job, deps)).rejects.toThrow(SecurityChallengeError);

    expect(job.discarded).toBe(true);
    expect(markAwaitingHumanAction.mock.calls[0]?.[0]).toBe("applicant-1");
    expect(markAwaitingHumanAction.mock.calls[0]?.[1]).toBe("TWO_FACTOR");
  });

  it("keeps the job retryable (no discard) on a technical error", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi.fn().mockRejectedValue(new TechnicalAutomationError("TIMEOUT")),
      handleSecurityChallenge: vi.fn(),
    };
    const deps = buildDeps({ emailVerificationWorker });
    const job = new FakeJob(baseJobData());

    await expect(processAutomationJob(job, deps)).rejects.toThrow(TechnicalAutomationError);

    expect(job.discarded).toBe(false);
    const actions = deps.sink.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("automation_job_attempt_failed");
  });

  it("marks the applicant FAILED once technical retries are exhausted", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi.fn().mockRejectedValue(new TechnicalAutomationError("PAGE_UNAVAILABLE")),
      handleSecurityChallenge: vi.fn(),
    };
    const markFailed = vi.fn();
    const deps = buildDeps({
      emailVerificationWorker,
      applicantStatusRepository: { markAwaitingHumanAction: vi.fn(), markFailed },
    });
    const job = new FakeJob(baseJobData());
    job.attemptsMade = 2; // 3a e ultima tentativa (opts.attempts = 3)

    await expect(processAutomationJob(job, deps)).rejects.toThrow(TechnicalAutomationError);

    expect(markFailed).toHaveBeenCalledWith("applicant-1", "PAGE_UNAVAILABLE");
    const actions = deps.sink.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("automation_job_failed_final");
  });

  it("does NOT mark the applicant FAILED while retries remain", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi.fn().mockRejectedValue(new TechnicalAutomationError("TIMEOUT")),
      handleSecurityChallenge: vi.fn(),
    };
    const markFailed = vi.fn();
    const deps = buildDeps({
      emailVerificationWorker,
      applicantStatusRepository: { markAwaitingHumanAction: vi.fn(), markFailed },
    });
    const job = new FakeJob(baseJobData());
    job.attemptsMade = 0; // 1a de 3 tentativas

    await expect(processAutomationJob(job, deps)).rejects.toThrow(TechnicalAutomationError);

    expect(markFailed).not.toHaveBeenCalled();
  });

  it("releases concurrency locks even when the step throws", async () => {
    const emailVerificationWorker: IEmailVerificationWorker = {
      findVerificationCode: vi
        .fn()
        .mockRejectedValue(new TechnicalAutomationError("CONNECTION_FAILURE")),
      handleSecurityChallenge: vi.fn(),
    };
    const deps = buildDeps({ emailVerificationWorker });
    const job = new FakeJob(baseJobData());

    await expect(processAutomationJob(job, deps)).rejects.toThrow();

    expect(deps.redis.counters.get("concurrency:proxy:proxy-1")).toBe(0);
    expect(deps.redis.counters.get("concurrency:applicant:applicant-1")).toBe(0);
  });
});
