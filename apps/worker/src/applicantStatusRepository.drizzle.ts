import { eq } from "drizzle-orm";
import { db, applicants } from "@uber-automation/database";
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
  async markAwaitingHumanAction(applicantId: string, reason: string): Promise<void> {
    await db
      .update(applicants)
      .set({
        status: "AWAITING_HUMAN_ACTION",
        pauseReason: reason,
        pausedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applicants.id, applicantId));
  }
}
