export const QUEUE_NAMES = {
  AUTOMATION_JOBS: "automation-jobs",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
