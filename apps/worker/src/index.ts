import { Worker } from "bullmq";
import IORedis from "ioredis";
import { AuditLogger } from "@uber-automation/security";
import { createDatabaseAuditLogSink } from "@uber-automation/database";
import { EmailVerificationWorker } from "@uber-automation/email-service";
import { BrowserProfileManager } from "@uber-automation/automation";
import { env } from "./env";
import { QUEUE_NAMES } from "./queues";
import { progressiveBackoffStrategy } from "./backoff";
import { ConcurrencyLimiter } from "./concurrencyLimiter";
import { processAutomationJob, type AutomationJobLike } from "./processor";
import { DrizzleApplicantStatusRepository } from "./applicantStatusRepository.drizzle";
import type { AutomationJob } from "./automationJob.types";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const auditLogger = new AuditLogger({ sink: createDatabaseAuditLogSink() });
const limiter = new ConcurrencyLimiter(connection);
const browserProfileManager = new BrowserProfileManager({ auditLogger });
const emailVerificationWorker = new EmailVerificationWorker({
  auditLogger,
  browserProfileHooks: {
    async loadGmailSession(applicantId) {
      const profileId = await browserProfileManager.getActiveProfileId(applicantId);
      if (!profileId) return undefined;

      const validation = await browserProfileManager.validateProfileDetailed(profileId);
      if (!validation.valid) return undefined;

      const loaded = await browserProfileManager.loadProfile(profileId).catch(() => null);
      if (!loaded) return undefined;
      return { cookies: loaded.data.gmail.cookies, localStorage: loaded.data.gmail.localStorage };
    },
    async saveGmailSession() {
      // Persistencia da sessao do Gmail de volta no BrowserProfileManager
      // (gravar cookies/localStorage em disco) e um refinamento de Fase 3.
    },
    async lockOnSecurityChallenge(applicantId, reason) {
      const profileId = await browserProfileManager.getActiveProfileId(applicantId);
      if (profileId) {
        await browserProfileManager.lockProfile(profileId, reason).catch(() => undefined);
      }
    },
  },
});
const applicantStatusRepository = new DrizzleApplicantStatusRepository();

const worker = new Worker<AutomationJob>(
  QUEUE_NAMES.AUTOMATION_JOBS,
  async (job) => {
    await processAutomationJob(job as unknown as AutomationJobLike, {
      limiter,
      auditLogger,
      emailVerificationWorker,
      applicantStatusRepository,
    });
  },
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    settings: { backoffStrategy: progressiveBackoffStrategy },
  },
);

worker.on("ready", () => {
  console.log(`Worker ready, listening on queue "${QUEUE_NAMES.AUTOMATION_JOBS}"`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] job ${job?.id} failed: ${error.message}`);
});

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

async function shutdown() {
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
