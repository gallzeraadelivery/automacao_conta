import { Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";
import { QUEUE_NAMES } from "./queues";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Placeholder: nenhum processador de automacao esta implementado na Fase 1.
// A partir da Fase 3 este worker passa a consumir jobs de preenchimento
// administrativo e leitura de codigos de confirmacao no Gmail.
const worker = new Worker(
  QUEUE_NAMES.APPLICANT_REGISTRATION,
  async (job) => {
    console.log(`[worker] received job ${job.id} (${job.name}) - no processor implemented yet`);
  },
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

worker.on("ready", () => {
  console.log(`Worker ready, listening on queue "${QUEUE_NAMES.APPLICANT_REGISTRATION}"`);
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
