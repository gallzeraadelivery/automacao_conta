import { Worker } from "bullmq";
import IORedis from "ioredis";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuditLogger } from "@uber-automation/security";
import { createDatabaseAuditLogSink } from "@uber-automation/database";
import { BrowserProfileManager } from "@uber-automation/automation";
import { env } from "./env";
import { QUEUE_NAMES } from "./queues";
import { progressiveBackoffStrategy } from "./backoff";
import { ConcurrencyLimiter } from "./concurrencyLimiter";
import { processAutomationJob, type AutomationJobLike } from "./processor";
import { DrizzleApplicantStatusRepository } from "./applicantStatusRepository.drizzle";
import { createUberAutomationRunner } from "./uberAutomationRunner";
import { createManualBrowserRunner } from "./manualBrowserRunner";
import { createScopedEmailVerificationWorker } from "./emailVerificationWorkerFactory";
import type { AutomationJob } from "./automationJob.types";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const auditLogger = new AuditLogger({ sink: createDatabaseAuditLogSink() });
const limiter = new ConcurrencyLimiter(connection);
const applicantStatusRepository = new DrizzleApplicantStatusRepository();
const runAdministrativeFlow = createUberAutomationRunner({ auditLogger });
const runManualBrowser = createManualBrowserRunner({ auditLogger });

console.log(
  `[worker] AUTOMATION_TARGET=${env.AUTOMATION_TARGET}` +
    (env.AUTOMATION_TARGET === "mock" ? ` (${env.MOCK_UBER_BASE_URL})` : " (Uber real - CUIDADO)"),
);

const worker = new Worker<AutomationJob>(
  QUEUE_NAMES.AUTOMATION_JOBS,
  async (job) => {
    // BrowserProfileManager/EmailVerificationWorker sao construidos por job
    // (nao como singleton do modulo) porque ambos so aceitam `companyId` na
    // construcao, usado so para correlacionar audit logs - um singleton
    // compartilhado entre empresas diferentes nao teria como acertar esse
    // valor para todas. Ver emailVerificationWorkerFactory.ts.
    const browserProfileManager = new BrowserProfileManager({
      auditLogger,
      companyId: job.data.companyId,
      storageRoot:
        process.env.BROWSER_PROFILES_STORAGE_PATH &&
        path.isAbsolute(process.env.BROWSER_PROFILES_STORAGE_PATH)
          ? process.env.BROWSER_PROFILES_STORAGE_PATH
          : path.resolve(
              path.dirname(fileURLToPath(import.meta.url)),
              "../../storage/browser-profiles",
            ),
    });
    const emailVerificationWorker = createScopedEmailVerificationWorker(
      job.data.companyId,
      auditLogger,
      browserProfileManager,
    );

    await processAutomationJob(job as unknown as AutomationJobLike, {
      limiter,
      auditLogger,
      emailVerificationWorker,
      applicantStatusRepository,
      runAdministrativeFlow,
      runManualBrowser,
    });
  },
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    // Browser manual fica aberto minutos; lock longo + renovação automática.
    // maxStalledCount 1: se o worker cair, tenta 1x — o runner ignora
    // reentrega do mesmo job sem abrir outro Chromium.
    lockDuration: 120_000,
    maxStalledCount: 1,
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
