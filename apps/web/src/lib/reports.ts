export interface AutomationReport {
  period: { from: string; to: string };
  totalProcessed: number;
  successfulCount: number;
  failedCount: number;
  pausedCount: number;
  successRate: number;
  averageTimeToCompleteSeconds: number;
  providerDistribution: { socure: number; other: number; unknown: number };
  errorDistribution: Record<string, number>;
  topErrors: Array<{ code: string; count: number; message: string }>;
}

export interface AuditReport {
  period: { from: string; to: string };
  totalActions: number;
  actionsByType: Record<string, number>;
  actionsByOperator: Array<{ operator: string; count: number }>;
  securityEvents: Array<{ timestamp: string; event: string; severity: "LOW" | "MEDIUM" | "HIGH" }>;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = (minutes / 60).toFixed(1);
  return `${hours}h`;
}
