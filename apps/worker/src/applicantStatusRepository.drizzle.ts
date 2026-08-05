import { eq } from "drizzle-orm";
import { db, applicants, emailAccounts } from "@uber-automation/database";
import type { ApplicantStatusRepository } from "./processor";

/**
 * "Notifica o operador": atualiza o status do candidato para
 * AWAITING_HUMAN_ACTION, com o motivo (`pauseReason` - ver PAUSE_REASONS em
 * @uber-automation/database) e o instante da pausa, para alimentar a
 * Central de Pendências (Fase 6). O motivo detalhado/legível continua no
 * log de auditoria (processor.ts) - aqui só a categoria, nunca texto livre
 * ou dado sensível.
 */
export class DrizzleApplicantStatusRepository implements ApplicantStatusRepository {
  async markAwaitingHumanAction(
    applicantId: string,
    reason: string,
    providers?: {
      profilePhotoProvider?: string;
      profilePhotoConfidence?: string;
      driverLicenseProvider?: string;
      driverLicenseConfidence?: string;
    },
  ): Promise<void> {
    await db
      .update(applicants)
      .set({
        status: "AWAITING_HUMAN_ACTION",
        pauseReason: reason,
        pausedAt: new Date(),
        updatedAt: new Date(),
        ...(providers?.profilePhotoProvider
          ? {
              profilePhotoProvider: providers.profilePhotoProvider,
              profilePhotoConfidence: providers.profilePhotoConfidence ?? null,
            }
          : {}),
        ...(providers?.driverLicenseProvider
          ? {
              driverLicenseProvider: providers.driverLicenseProvider,
              driverLicenseConfidence: providers.driverLicenseConfidence ?? null,
            }
          : {}),
      })
      .where(eq(applicants.id, applicantId));
  }

  async markInProgress(applicantId: string, currentStep: string): Promise<void> {
    await db
      .update(applicants)
      .set({ status: "IN_PROGRESS", currentStep, updatedAt: new Date() })
      .where(eq(applicants.id, applicantId));
  }

  /**
   * O adaptador terminou o fluxo administrativo sem encontrar nenhuma etapa
   * sensivel pendente nesta sessao (ex: pagina de "cadastro em analise") -
   * nao significa que o motorista esta 100% aprovado na Uber, so que nao ha
   * mais nada administrativo para este sistema fazer.
   */
  async markCompleted(applicantId: string): Promise<void> {
    await db
      .update(applicants)
      .set({ status: "COMPLETED", updatedAt: new Date() })
      .where(eq(applicants.id, applicantId));
  }

  /**
   * Esgotou as tentativas por erro TÉCNICO (não uma pausa de regra - ver
   * markAwaitingHumanAction) - ex: seletor não encontrado, timeout de rede.
   * Sem isso o motorista ficaria "IN_PROGRESS" para sempre, sem aparecer em
   * nenhum lugar visível para o operador revisar. Reaproveita a coluna
   * pause_reason (varchar livre, sem enum no banco) para o motivo técnico -
   * mesma ideia de "por que isto parou", categoria diferente de PAUSE_REASONS.
   */
  async markFailed(applicantId: string, reason: string): Promise<void> {
    await db
      .update(applicants)
      .set({
        status: "FAILED",
        pauseReason: reason,
        pausedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applicants.id, applicantId));
  }

  /**
   * Uber Internal Server Error / fluxo Delivery quebrado: FAILED + soft-delete
   * do e-mail para não reutilizar a conta queimada.
   */
  async markDiscarded(applicantId: string, emailAccountId: string, reason: string): Promise<void> {
    await this.markFailed(applicantId, reason);
    await db
      .update(emailAccounts)
      .set({
        deletedAt: new Date(),
        requiresHumanAction: false,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, emailAccountId));
  }

  async markStopped(applicantId: string): Promise<void> {
    await db
      .update(applicants)
      .set({
        status: "READY_TO_START",
        pauseReason: null,
        pausedAt: null,
        currentStep: null,
        updatedAt: new Date(),
      })
      .where(eq(applicants.id, applicantId));
  }
}
