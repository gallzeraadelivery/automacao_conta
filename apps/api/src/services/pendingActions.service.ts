import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  applicants,
  operators,
  auditLogs,
  driverDeliveries,
  type Applicant,
} from "@uber-automation/database";

export interface PendingActionView {
  id: string;
  applicantId: string;
  applicantName: string;
  email: string;
  phone: string | null;
  city: string | null;
  vehicleType: string | null;
  status: string;
  currentStep: string | null;
  pauseReason: string | null;
  profilePhotoProvider: string | null;
  profilePhotoConfidence: string | null;
  driverLicenseProvider: string | null;
  driverLicenseConfidence: string | null;
  pausedAt: Date | null;
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  resolvedAt: Date | null;
}

function toPendingActionView(
  applicant: Applicant,
  assignedOperatorName: string | null,
): PendingActionView {
  return {
    id: applicant.id,
    applicantId: applicant.id,
    applicantName: applicant.fullName,
    email: applicant.email,
    phone: applicant.phone,
    city: applicant.city,
    vehicleType: applicant.vehicleType,
    status: applicant.status,
    currentStep: applicant.currentStep,
    pauseReason: applicant.pauseReason,
    profilePhotoProvider: applicant.profilePhotoProvider,
    profilePhotoConfidence: applicant.profilePhotoConfidence,
    driverLicenseProvider: applicant.driverLicenseProvider,
    driverLicenseConfidence: applicant.driverLicenseConfidence,
    pausedAt: applicant.pausedAt,
    assignedOperatorId: applicant.assignedOperatorId,
    assignedOperatorName,
    resolvedAt: applicant.resolvedAt,
  };
}

export interface ListPendingActionsParams {
  assignedTo?: string;
  sortBy?: "pausedAt" | "createdAt";
}

/**
 * A Central de Pendências não tem uma tabela própria - é uma visão sobre
 * `applicants` filtrada por `status = 'AWAITING_HUMAN_ACTION'`. Isso evita
 * duplicar estado (o status já é a fonte da verdade, atualizada pelo worker
 * quando a automação pausa - ver `apps/worker/src/applicantStatusRepository.drizzle.ts`).
 */
export async function listPendingActions(
  companyId: string,
  params: ListPendingActionsParams,
): Promise<PendingActionView[]> {
  const conditions = [
    eq(applicants.companyId, companyId),
    eq(applicants.status, "AWAITING_HUMAN_ACTION"),
  ];
  if (params.assignedTo) {
    conditions.push(eq(applicants.assignedOperatorId, params.assignedTo));
  }

  const sortColumn = params.sortBy === "createdAt" ? applicants.createdAt : applicants.pausedAt;

  const rows = await db
    .select({ applicant: applicants, assignedOperatorName: operators.name })
    .from(applicants)
    .leftJoin(operators, eq(applicants.assignedOperatorId, operators.id))
    .where(and(...conditions))
    .orderBy(desc(sortColumn));

  return rows.map((row) => toPendingActionView(row.applicant, row.assignedOperatorName));
}

export async function getPendingActionById(
  companyId: string,
  id: string,
): Promise<PendingActionView | null> {
  const [row] = await db
    .select({ applicant: applicants, assignedOperatorName: operators.name })
    .from(applicants)
    .leftJoin(operators, eq(applicants.assignedOperatorId, operators.id))
    .where(and(eq(applicants.companyId, companyId), eq(applicants.id, id)))
    .limit(1);

  if (!row) return null;
  return toPendingActionView(row.applicant, row.assignedOperatorName);
}

export type PendingActionAction = "RESOLVED" | "CANCELLED" | "MANUAL_REVIEW";

/**
 * RESOLVED/CANCELLED encerram a pendência (o motorista concluiu a etapa
 * pessoalmente, ou o cadastro foi cancelado - nunca automaticamente, sempre
 * por decisão de um operador humano). MANUAL_REVIEW não muda o status -
 * apenas "reivindica" o caso para o operador atual, sem tirá-lo da fila de
 * pendências.
 */
export async function updatePendingAction(
  companyId: string,
  id: string,
  operatorId: string,
  action: PendingActionAction,
): Promise<PendingActionView | null> {
  const existing = await getPendingActionById(companyId, id);
  if (!existing) return null;

  if (action === "MANUAL_REVIEW") {
    await db
      .update(applicants)
      .set({ assignedOperatorId: operatorId, updatedAt: new Date() })
      .where(and(eq(applicants.companyId, companyId), eq(applicants.id, id)));
  } else {
    await db
      .update(applicants)
      .set({
        status: action,
        resolvedByOperatorId: operatorId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(applicants.companyId, companyId), eq(applicants.id, id)));
  }

  return getPendingActionById(companyId, id);
}

export async function getPendingActionAuditLogs(
  companyId: string,
  applicantId: string,
  limit = 50,
) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.applicantId, applicantId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export interface CreateDeliveryResult {
  token: string;
  expiresAt: Date;
}

/**
 * Gera um link seguro e temporário para o motorista completar pessoalmente
 * a etapa sensível diretamente na plataforma real - NUNCA um "handoff" de
 * uma sessão de navegador/automação ao vivo (ver `driverDeliveries.ts`).
 * Só o hash SHA-256 do token vai para o banco; o token em texto puro é
 * devolvido uma única vez aqui, para a resposta da API.
 */
export function hashDeliveryToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createDriverDelivery(
  companyId: string,
  applicantId: string,
  operatorId: string,
  expiresInSeconds: number,
): Promise<CreateDeliveryResult> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashDeliveryToken(token);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await db.insert(driverDeliveries).values({
    companyId,
    applicantId,
    tokenHash,
    createdByOperatorId: operatorId,
    expiresAt,
  });

  return { token, expiresAt };
}

export type DeliveryStatus = "VALID" | "EXPIRED" | "REVOKED" | "NOT_FOUND";

export interface DeliveryView {
  applicantFirstName: string | null;
  status: DeliveryStatus;
  expiresAt: Date | null;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Endpoint público (sem autenticação de operador - quem acessa é o
 * motorista). Resolve um token de entrega, marcando `openedAt` na primeira
 * vez. Nunca expõe o e-mail/telefone completo do motorista nem qualquer
 * dado além do primeiro nome - o link em si já é o segredo (256 bits de
 * entropia, hash SHA-256 armazenado), então isto é uma camada extra de
 * minimização de dados, não a proteção principal.
 */
export async function resolveDelivery(token: string): Promise<DeliveryView> {
  const tokenHash = hashDeliveryToken(token);

  const [row] = await db
    .select({ delivery: driverDeliveries, applicant: applicants })
    .from(driverDeliveries)
    .innerJoin(applicants, eq(driverDeliveries.applicantId, applicants.id))
    .where(eq(driverDeliveries.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    return { applicantFirstName: null, status: "NOT_FOUND", expiresAt: null };
  }

  if (row.delivery.revokedAt) {
    return {
      applicantFirstName: firstName(row.applicant.fullName),
      status: "REVOKED",
      expiresAt: row.delivery.expiresAt,
    };
  }

  if (row.delivery.expiresAt.getTime() < Date.now()) {
    return {
      applicantFirstName: firstName(row.applicant.fullName),
      status: "EXPIRED",
      expiresAt: row.delivery.expiresAt,
    };
  }

  if (!row.delivery.openedAt) {
    await db
      .update(driverDeliveries)
      .set({ openedAt: new Date() })
      .where(eq(driverDeliveries.id, row.delivery.id));
  }

  return {
    applicantFirstName: firstName(row.applicant.fullName),
    status: "VALID",
    expiresAt: row.delivery.expiresAt,
  };
}
