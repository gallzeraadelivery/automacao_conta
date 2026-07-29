import { eq } from "drizzle-orm";
import { db, emailAccounts } from "@uber-automation/database";
import type {
  EmailAccountCredentialRecord,
  EmailAccountRepository,
} from "./emailAccountRepository";

export class DrizzleEmailAccountRepository implements EmailAccountRepository {
  async getById(emailAccountId: string): Promise<EmailAccountCredentialRecord | null> {
    const [row] = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, emailAccountId))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      emailAddress: row.emailAddress,
      encryptedPassword: row.encryptedPassword,
      encryptionIv: row.encryptionIv,
      encryptionAuthTag: row.encryptionAuthTag,
      provider: row.provider,
    };
  }

  async markRequiresHumanAction(emailAccountId: string, reason: string): Promise<void> {
    await db
      .update(emailAccounts)
      .set({ requiresHumanAction: true, loginStatus: reason, updatedAt: new Date() })
      .where(eq(emailAccounts.id, emailAccountId));
  }

  async recordLoginResult(emailAccountId: string, status: string): Promise<void> {
    await db
      .update(emailAccounts)
      .set({ loginStatus: status, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(emailAccounts.id, emailAccountId));
  }
}
