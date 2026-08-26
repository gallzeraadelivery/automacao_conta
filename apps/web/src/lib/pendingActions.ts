export interface PendingActionView {
  id: string;
  applicantId: string;
  applicantName: string;
  email: string;
  phone: string | null;
  city: string | null;
  proxyGeoCity: string | null;
  proxyGeoRegion: string | null;
  proxyExternalIp: string | null;
  vehicleType: string | null;
  status: string;
  currentStep: string | null;
  pauseReason: string | null;
  profilePhotoProvider: string | null;
  profilePhotoConfidence: string | null;
  driverLicenseProvider: string | null;
  driverLicenseConfidence: string | null;
  pausedAt: string | null;
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  resolvedAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  companyId: string;
  operatorId: string | null;
  applicantId: string | null;
  action: string;
  metadataSanitized: Record<string, unknown> | null;
  createdAt: string;
}

export const PAUSE_REASON_LABELS: Record<string, string> = {
  IDENTITY_VERIFICATION_REQUIRED: "Verificação de identidade exigida",
  NON_SOCURE_PROVIDER: "Provedor diferente de Socure detectado",
  CAPTCHA: "CAPTCHA detectado",
  TWO_FACTOR: "Autenticação em duas etapas (2FA)",
  SECURITY_BLOCK: "Bloqueio de segurança",
  PHONE_PROBLEM: "Problema celular",
  PAGE_UNAVAILABLE: "Página indisponível",
  REFUSED: "Recusado pela Uber",
};

export function pauseReasonLabel(reason: string | null): string {
  if (!reason) return "-";
  return PAUSE_REASON_LABELS[reason] ?? reason;
}
