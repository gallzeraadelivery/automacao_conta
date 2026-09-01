/** Formato: GD-XXXX-XXXX (A-Z, 2-9 — sem 0/O/1/I para leitura fácil). */
export const LICENSE_KEY_PREFIX = "GD";
export const LICENSE_KEY_REGEX = /^GD-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export const LICENSE_KEY_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeLicenseKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidLicenseKeyFormat(key: string): boolean {
  return LICENSE_KEY_REGEX.test(normalizeLicenseKey(key));
}

export type LicenseStatus = "active" | "revoked" | "expired";

export interface LicenseActivationPayload {
  licenseKey: string;
  machineId: string;
  hostname: string;
  appVersion?: string;
}

export interface LicenseHeartbeatPayload {
  licenseKey: string;
  machineId: string;
}

export interface LicenseClientStatus {
  ok: boolean;
  status: LicenseStatus | "unknown";
  message: string;
  expiresAt?: string | null;
}

export interface LicenseRecord {
  id: string;
  licenseKey: string;
  label: string | null;
  status: LicenseStatus;
  maxMachines: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseActivationRecord {
  id: string;
  licenseKey: string;
  machineId: string;
  hostname: string;
  appVersion: string | null;
  lastSeenAt: string;
  createdAt: string;
}
