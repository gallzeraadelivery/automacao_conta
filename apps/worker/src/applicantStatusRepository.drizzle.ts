import { eq } from "drizzle-orm";
import { db, applicants } from "@uber-automation/database";
import type { ApplicantStatusRepository } from "./processor";

/**
 * "Notifica o operador" na Fase 2: como nao ha canal de notificacao dedicado
 * ainda, a forma de sinalizar que um motorista precisa de intervencao humana
 * e atualizar o status do candidato para AWAITING_HUMAN_ACTION - isso ja
 * aparece no dashboard/listagem existentes desde a Fase 1. O motivo fica no
 * log de auditoria (processor.ts), nunca em texto sensivel aqui.
 */
export class DrizzleApplicantStatusRepository implements ApplicantStatusRepository {
  async markAwaitingHumanAction(applicantId: string): Promise<void> {
    await db
      .update(applicants)
      .set({ status: "AWAITING_HUMAN_ACTION", updatedAt: new Date() })
      .where(eq(applicants.id, applicantId));
  }
}
