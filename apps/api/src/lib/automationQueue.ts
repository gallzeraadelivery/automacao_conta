import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env";

/**
 * Nome da fila que apps/worker escuta (apps/worker/src/queues.ts,
 * QUEUE_NAMES.AUTOMATION_JOBS) - duplicado aqui em vez de importado porque
 * apps/api e apps/worker são apps independentes no workspace.
 */
const AUTOMATION_JOBS_QUEUE = "automation-jobs";

let queue: Queue | null = null;

function getQueue(): Queue {
  if (!queue) {
    const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(AUTOMATION_JOBS_QUEUE, { connection });
  }
  return queue;
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
