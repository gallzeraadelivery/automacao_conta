import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_NAMES } from "./queues";
import { MAX_ATTEMPTS } from "./backoff";
import type { AutomationJob } from "./automationJob.types";

let queue: Queue<AutomationJob> | undefined;

export function getAutomationQueue(connection: ConnectionOptions): Queue<AutomationJob> {
  if (!queue) {
    queue = new Queue<AutomationJob>(QUEUE_NAMES.AUTOMATION_JOBS, {
      connection,
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "custom" },
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    });
  }
  return queue;
}

export async function addAutomationJob(
  connection: ConnectionOptions,
  data: AutomationJob,
): Promise<string> {
  const job = await getAutomationQueue(connection).add(`applicant-${data.applicantId}`, data);
  return job.id!;
}
