import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env";
import {
  MANUAL_BROWSER_STOP_TTL_SEC,
  manualBrowserActiveJobKey,
  manualBrowserStopKey,
} from "./manualBrowserControl";
import { HttpError } from "../middleware/errorHandler";

/**
 * Nome da fila que apps/worker escuta (apps/worker/src/queues.ts,
 * QUEUE_NAMES.AUTOMATION_JOBS) - duplicado aqui em vez de importado porque
 * apps/api e apps/worker são apps independentes no workspace.
 */
const AUTOMATION_JOBS_QUEUE = "automation-jobs";

let queue: Queue | null = null;
let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return redis;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(AUTOMATION_JOBS_QUEUE, { connection: getRedis() });
  }
  return queue;
}

function manualBrowserJobId(applicantId: string): string {
  return `open-manual-${applicantId}`;
}

export interface EncryptedCredentialPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "AES-256-GCM";
}

export interface StartAutomationJobInput {
  companyId: string;
  applicantId: string;
  emailAccountId: string;
  proxyId: string;
  applicantData: {
    fullName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    postalCode: string;
    vehicleType: string;
  };
  platformCredential: EncryptedCredentialPayload;
}

/** Enfileira um job RUN_ADMINISTRATIVE_FLOW para apps/worker processar. */
export async function enqueueStartAutomationJob(input: StartAutomationJobInput): Promise<string> {
  const job = await getQueue().add(
    "run-administrative-flow",
    {
      companyId: input.companyId,
      applicantId: input.applicantId,
      emailAccountId: input.emailAccountId,
      proxyId: input.proxyId,
      platformAdapter: "uber",
      currentStep: "RUN_ADMINISTRATIVE_FLOW",
      retryCount: 0,
      createdAt: new Date().toISOString(),
      applicantData: input.applicantData,
      platformCredential: input.platformCredential,
    },
    { attempts: 3 },
  );
  return job.id ?? "";
}

export interface OpenManualBrowserJobInput {
  companyId: string;
  applicantId: string;
  emailAccountId: string;
  proxyId: string;
}

/** Enfileira Chromium headed com proxy + cookies para intervenção manual. */
export async function enqueueOpenManualBrowserJob(
  input: OpenManualBrowserJobInput,
): Promise<string> {
  const q = getQueue();
  const r = getRedis();
  const jobId = manualBrowserJobId(input.applicantId);

  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed" || state === "prioritized") {
      throw new HttpError(
        409,
        "MANUAL_BROWSER_ALREADY_OPEN",
        "Browser manual já está aberto ou na fila. Use «Fechar browser» antes de abrir de novo.",
      );
    }
    await existing.remove().catch(() => undefined);
  }

  // Limpa sinal de stop e marcador de sessão anterior (worker morto / Fechar).
  await r.del(manualBrowserStopKey(input.applicantId));
  await r.del(manualBrowserActiveJobKey(input.applicantId));

  const job = await q.add(
    "open-manual-browser",
    {
      companyId: input.companyId,
      applicantId: input.applicantId,
      emailAccountId: input.emailAccountId,
      proxyId: input.proxyId,
      platformAdapter: "uber",
      currentStep: "OPEN_MANUAL_BROWSER",
      retryCount: 0,
      createdAt: new Date().toISOString(),
    },
    {
      jobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
  return job.id ?? jobId;
}

export interface CloseManualBrowserResult {
  stopSignaled: boolean;
  removedQueuedJobs: number;
  clearedActiveMarker: boolean;
}

/**
 * Pede ao worker para fechar o Chromium manual, remove jobs na fila e
 * limpa o marcador active (libera novo «Abrir»).
 */
export async function signalCloseManualBrowser(
  applicantId: string,
): Promise<CloseManualBrowserResult> {
  const q = getQueue();
  const r = getRedis();

  await r.set(manualBrowserStopKey(applicantId), "1", "EX", MANUAL_BROWSER_STOP_TTL_SEC);

  let removedQueuedJobs = 0;
  const jobs = await q.getJobs(["waiting", "delayed", "paused", "prioritized", "active"], 0, 200);
  for (const job of jobs) {
    const data = job.data as { applicantId?: string; currentStep?: string } | undefined;
    if (data?.applicantId !== applicantId) continue;
    if (data.currentStep !== "OPEN_MANUAL_BROWSER") continue;
    const state = await job.getState().catch(() => null);
    if (state === "active") {
      // Runner escuta o stop key e fecha sozinho — não remove active à força.
      continue;
    }
    await job.remove().catch(() => undefined);
    removedQueuedJobs += 1;
  }

  // Permite Abrir de novo mesmo se o worker morreu sem limpar.
  const cleared = (await r.del(manualBrowserActiveJobKey(applicantId))) > 0;

  // Libera locks de concorrência deste motorista (best-effort).
  const applicantLock = `concurrency:applicant:${applicantId}`;
  await r.del(applicantLock).catch(() => undefined);

  return { stopSignaled: true, removedQueuedJobs, clearedActiveMarker: cleared };
}

/**
 * Remove jobs ainda na fila deste motorista (waiting/delayed/paused).
 * Jobs `active` (já no Playwright) não são interrompidos aqui - o worker
 * falha sozinho se o registro sumir. Best-effort.
 */
export async function cancelAutomationJobsForApplicant(applicantId: string): Promise<number> {
  const q = getQueue();
  const jobs = await q.getJobs(["waiting", "delayed", "paused", "prioritized"], 0, 500);
  let removed = 0;
  for (const job of jobs) {
    const data = job.data as { applicantId?: string } | undefined;
    if (data?.applicantId !== applicantId) continue;
    await job.remove().catch(() => undefined);
    removed += 1;
  }
  return removed;
}
