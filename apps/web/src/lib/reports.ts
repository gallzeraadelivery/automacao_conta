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
  proxyGeoRows: Array<{
    id: string;
    externalId: string;
    fullName: string;
    status: string;
    proxyExternalIp: string | null;
    proxyGeoCity: string | null;
    proxyGeoRegion: string | null;
  }>;
}

export interface AuditReport {
  period: { from: string; to: string };
  totalActions: number;
  actionsByType: Record<string, number>;
  actionsByOperator: Array<{ operator: string; count: number }>;
  securityEvents: Array<{ timestamp: string; event: string; severity: "LOW" | "MEDIUM" | "HIGH" }>;
}

export type VerificationProviderFilter = "socure" | "veriff" | "all";

export interface VerificationReportRow {
  id: string;
  externalId: string;
  fullName: string;
  email: string;
  status: string;
  pauseReason: string | null;
  currentStep: string | null;
  profilePhotoProvider: string | null;
  profilePhotoConfidence: string | null;
  driverLicenseProvider: string | null;
  driverLicenseConfidence: string | null;
  proxyExternalIp: string | null;
  proxyGeoCity: string | null;
  proxyGeoRegion: string | null;
  cookiesDownloadedAt: string | null;
  pausedAt: string | null;
  updatedAt: string;
}

export interface VerificationReport {
  filter: VerificationProviderFilter;
  counts: { socure: number; veriff: number; all: number };
  total: number;
  items: VerificationReportRow[];
}

export interface SocureProxyGeoCityRow {
  city: string;
  region: string;
  total: number;
  socure: number;
  veriff: number;
  identidade: number;
  security: number;
  phone: number;
  pctSocure: number;
  pctVeriff: number;
}

export interface SocureProxyGeoReport {
  totals: {
    withGeo: number;
    cities: number;
    socure: number;
    veriff: number;
    identidade: number;
    security: number;
    phone: number;
  };
  bySocure: SocureProxyGeoCityRow[];
  byVeriff: SocureProxyGeoCityRow[];
  bySocureRate: SocureProxyGeoCityRow[];
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = (minutes / 60).toFixed(1);
  return `${hours}h`;
}
